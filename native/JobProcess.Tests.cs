// Standalone Windows fixture. Only re-launches this compiled test executable.
// A Job controls process lifetime and resources, and has no filesystem sandbox.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

static class JobProcessTests {
    const uint Suspended = 0x4, UnicodeEnvironment = 0x400, NoWindow = 0x08000000, Breakaway = 0x01000000;
    const uint LimitProcesses = 0x8, LimitProcessMemory = 0x100, LimitJobMemory = 0x200, KillOnClose = 0x2000;
    const uint AccessDenied = 5, Sync = 0x00100000, QueryLimitedInformation = 0x1000;
    const uint WaitTimeout = 0x102, TimeoutExitCode = 1460;
    static readonly string Executable = Assembly.GetExecutingAssembly().Location;

    [StructLayout(LayoutKind.Sequential)]
    struct StartupInfo {
        internal int Size;
        internal IntPtr Reserved, Desktop, Title;
        internal uint X, Y, Width, Height, Columns, Rows, Fill, Flags;
        internal ushort ShowWindow, ReservedLength;
        internal IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo {
        internal IntPtr Process, Thread;
        internal uint ProcessId, ThreadId;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimit {
        internal long ProcessTime, JobTime;
        internal uint Flags;
        internal UIntPtr MinWorkingSet, MaxWorkingSet;
        internal uint ActiveProcesses;
        internal UIntPtr Affinity;
        internal uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct JobLimit {
        internal BasicLimit Basic;
        internal ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
        internal UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct JobAccounting {
        internal long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
        internal uint PageFaults, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
    }
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    static extern SafeWaitHandle CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetInformationJobObject(SafeWaitHandle job, int kind, ref JobLimit info, int size);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool AssignProcessToJobObject(SafeWaitHandle job, SafeWaitHandle process);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool TerminateJobObject(SafeWaitHandle job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool QueryInformationJobObject(SafeWaitHandle job, int kind, out JobAccounting info, int size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool IsProcessInJob(SafeWaitHandle process, SafeWaitHandle job, out bool result);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetExitCodeProcess(SafeWaitHandle process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes,
        bool inheritHandles, uint flags, IntPtr environment, string cwd, ref StartupInfo startup, out ProcessInfo info);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern uint ResumeThread(SafeWaitHandle thread);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern uint WaitForSingleObject(SafeWaitHandle handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern SafeWaitHandle OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool TerminateProcess(SafeWaitHandle process, uint exitCode);

    static Win32Exception Failure(string action) { return new Win32Exception(Marshal.GetLastWin32Error(), action); }
    static void Require(bool condition, string action) { if (!condition) throw new InvalidOperationException(action); }

    static bool Create(string mode, string report, uint flags, out ProcessInfo info, out int error) {
        var command = new StringBuilder("\"" + Executable + "\" " + mode + " \"" + report + "\"");
        var startup = new StartupInfo { Size = Marshal.SizeOf(typeof(StartupInfo)) };
        IntPtr environment = Marshal.StringToHGlobalUni("SystemRoot=" + Environment.GetFolderPath(Environment.SpecialFolder.Windows) + "\0");
        try {
            bool ok = CreateProcessW(Executable, command, IntPtr.Zero, IntPtr.Zero, false, flags | UnicodeEnvironment | NoWindow,
                environment, Path.GetDirectoryName(report), ref startup, out info);
            error = ok ? 0 : Marshal.GetLastWin32Error();
            return ok;
        } finally { Marshal.FreeHGlobal(environment); }
    }

    static uint StartLeaf(string report, uint flags, out int error) {
        ProcessInfo info;
        if (!Create("leaf", report, flags, out info, out error)) return 0;
        using (var process = new SafeWaitHandle(info.Process, true))
        using (var thread = new SafeWaitHandle(info.Thread, true)) {
            // If Windows unexpectedly allows the breakaway probe, clean it up while suspended.
            if ((flags & Breakaway) != 0 && (!TerminateProcess(process, 1) || WaitForSingleObject(process, 5000) != 0))
                throw Failure("Clean up unexpected breakaway probe");
            return info.ProcessId;
        }
    }

    static void Worker(string report, bool probeProcessLimit) {
        Require(Environment.GetEnvironmentVariable("EMMA_TEST_PARENT_SECRET") == null, "Parent environment leaked");
        int error;
        uint leaf = StartLeaf(report, 0, out error);
        Require(leaf != 0, "Job child failed to start: " + error);
        if (probeProcessLimit) {
            uint extra = StartLeaf(report, 0, out error);
            Require(extra == 0, "Job active process limit was exceeded");
        }
        File.WriteAllText(report + ".tmp", leaf.ToString());
        File.Move(report + ".tmp", report);
        Thread.Sleep(15000);
    }

    static void BreakawayWorker(string report) {
        int error;
        Require(StartLeaf(report, Breakaway | Suspended, out error) == 0 && error == AccessDenied, "Job breakaway was not denied");
        File.WriteAllText(report + ".tmp", "denied");
        File.Move(report + ".tmp", report);
    }

    static uint ActiveProcesses(SafeWaitHandle job) {
        JobAccounting accounting;
        if (!QueryInformationJobObject(job, 1, out accounting, Marshal.SizeOf(typeof(JobAccounting)), IntPtr.Zero))
            throw Failure("Query job accounting");
        return accounting.ActiveProcesses;
    }

    static void RequireLiveMember(SafeWaitHandle job, SafeWaitHandle process) {
        bool member;
        if (!IsProcessInJob(process, job, out member)) throw Failure("Query job membership");
        Require(member && WaitForSingleObject(process, 0) == WaitTimeout, "Fixture process is not running in the Job");
    }

    static void VerifyTimeout(SafeWaitHandle job, SafeWaitHandle root, SafeWaitHandle leaf) {
        RequireLiveMember(job, root);
        RequireLiveMember(job, leaf);
        var fired = new TaskCompletionSource<bool>();
        using (var watchdog = new Timer(_ => {
            try {
                RequireLiveMember(job, root);
                RequireLiveMember(job, leaf);
                if (!TerminateJobObject(job, TimeoutExitCode)) throw Failure("Terminate job from timer");
                fired.SetResult(true);
            } catch (Exception failure) {
                fired.SetException(failure);
            }
        }, null, 250, Timeout.Infinite)) {
            Require(fired.Task.Wait(5000), "Job timeout callback did not finish");
        }
    }

    static void RequireTimeoutExit(SafeWaitHandle process) {
        uint exitCode;
        if (!GetExitCodeProcess(process, out exitCode)) throw Failure("Query process exit code");
        Require(exitCode == TimeoutExitCode, "Process did not exit with the timer's termination code");
    }

    static void Run(string mode, string report) {
        Require(Environment.GetEnvironmentVariable("EMMA_TEST_PARENT_SECRET") == "fixture-only", "Missing parent environment fixture");
        using (var job = CreateJobObjectW(IntPtr.Zero, null)) {
            if (job.IsInvalid) throw Failure("CreateJobObject");
            bool breakaway = mode == "breakaway";
            var limits = new JobLimit {
                Basic = new BasicLimit { Flags = LimitProcesses | LimitProcessMemory | LimitJobMemory | KillOnClose,
                    ActiveProcesses = 2 },
                ProcessMemory = new UIntPtr(96 * 1024 * 1024), JobMemory = new UIntPtr(192 * 1024 * 1024),
            };
            if (!SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(JobLimit)))) throw Failure("SetInformationJobObject");
            ProcessInfo info;
            int error;
            string workerMode = "worker";
            if (breakaway) workerMode = "breakaway-worker";
            else if (mode == "timeout") workerMode = "timeout-worker";
            if (!Create(workerMode, report, Suspended, out info, out error))
                throw new Win32Exception(error, "Create suspended fixture");
            using (var root = new SafeWaitHandle(info.Process, true))
            using (var thread = new SafeWaitHandle(info.Thread, true)) {
                if (!AssignProcessToJobObject(job, root)) {
                    var failure = Failure("AssignProcessToJobObject");
                    if (!TerminateProcess(root, 1) || WaitForSingleObject(root, 5000) != 0) throw Failure("Clean up suspended fixture");
                    throw failure;
                }
                if (ResumeThread(thread) != 1) throw Failure("ResumeThread");
                var timer = Stopwatch.StartNew();
                while (!File.Exists(report) && timer.ElapsedMilliseconds < 5000) Thread.Sleep(10);
                Require(File.Exists(report), "Fixture report timed out");
                if (breakaway) {
                    Require(File.ReadAllText(report) == "denied" && WaitForSingleObject(root, 5000) == 0, "Breakaway test did not finish");
                } else {
                    using (var leaf = OpenProcess(Sync | QueryLimitedInformation, false, uint.Parse(File.ReadAllText(report)))) {
                        Require(!leaf.IsInvalid && WaitForSingleObject(leaf, 0) == WaitTimeout, "Job child is not running");
                        if (mode == "timeout") VerifyTimeout(job, root, leaf);
                        else if (mode == "close") job.Dispose();
                        else if (!TerminateJobObject(job, 1)) throw Failure("TerminateJobObject");
                        Require(WaitForSingleObject(root, 5000) == 0 && WaitForSingleObject(leaf, 5000) == 0, "Process tree survived stop");
                        if (mode == "timeout") {
                            RequireTimeoutExit(root);
                            RequireTimeoutExit(leaf);
                        }
                    }
                }
            }
            if (mode == "timeout") {
                var deadline = Stopwatch.StartNew();
                while (ActiveProcesses(job) != 0 && deadline.ElapsedMilliseconds < 5000) Thread.Sleep(10);
                uint remaining = ActiveProcesses(job);
                Require(remaining == 0, "Processes remained in the Job after timeout: " + remaining);
            }
        }
    }

    static int Main(string[] args) {
        try {
            Require(args.Length == 2, "Expected mode and fixture report path");
            string report = Path.GetFullPath(args[1]);
            switch (args[0]) {
                case "leaf": Thread.Sleep(15000); break;
                case "worker": Worker(report, true); break;
                case "timeout-worker": Worker(report, false); break;
                case "breakaway-worker": BreakawayWorker(report); break;
                case "terminate":
                case "close":
                case "breakaway":
                case "timeout":
                    Run(args[0], report);
                    Console.WriteLine(args[0] + ": PASS");
                    break;
                default: throw new ArgumentException("Unknown fixture mode");
            }
            return 0;
        } catch (Exception ex) { Console.Error.WriteLine(ex); return 1; }
    }
}
