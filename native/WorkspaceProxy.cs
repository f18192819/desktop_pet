// Windows x64 / local NTFS only. Protocol: one bounded JSON request on stdin.
// No shell, network, arbitrary executable, or credential handling.
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

static class Native {
    internal const uint Read = 0x80000000, Write = 0x40000000, Delete = 0x10000;
    internal static uint DirectoryShare = 3;
    [DllImport("KtmW32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern SafeFileHandle CreateTransaction(IntPtr attributes,IntPtr guid,uint options,uint isolation,uint isolationFlags,uint timeout,string description);
    [DllImport("KtmW32.dll",SetLastError=true)] internal static extern bool CommitTransaction(SafeFileHandle transaction);
    [DllImport("KtmW32.dll",SetLastError=true)] internal static extern bool RollbackTransaction(SafeFileHandle transaction);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern SafeFileHandle CreateFileTransactedW(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template,SafeFileHandle transaction,IntPtr version,IntPtr extended);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern bool CreateDirectoryTransactedW(string template,string path,IntPtr security,SafeFileHandle transaction);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool SetFilePointerEx(SafeFileHandle file,long offset,out long position,uint method);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool SetEndOfFile(SafeFileHandle file);
    [StructLayout(LayoutKind.Sequential)] internal struct US { public ushort Length, MaximumLength; public IntPtr Buffer; }
    [StructLayout(LayoutKind.Sequential)] internal struct OA { public int Length; public IntPtr Root, Name; public uint Attributes; public IntPtr Security, Qos; }
    [StructLayout(LayoutKind.Sequential)] internal struct IOS { public IntPtr Status, Information; }
    [StructLayout(LayoutKind.Sequential)] internal struct Info { public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, WriteTime; public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow; }
    [DllImport("ntdll.dll")] internal static extern int NtCreateFile(out SafeFileHandle h, uint access, ref OA oa, out IOS io, IntPtr allocation, uint attributes, uint share, uint disposition, uint options, IntPtr ea, uint eaLength);
    [DllImport("ntdll.dll")] internal static extern int NtSetInformationFile(SafeFileHandle h, out IOS io, IntPtr data, uint length, int kind);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] internal static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool GetFileInformationByHandle(SafeFileHandle h, out Info info);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool GetFileInformationByHandleEx(SafeFileHandle h, int kind, IntPtr buffer, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool FlushFileBuffers(SafeFileHandle h);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool ReadFile(SafeFileHandle h, byte[] data, uint count, out uint read, IntPtr overlap);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool WriteFile(SafeFileHandle h, byte[] data, uint count, out uint written, IntPtr overlap);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] internal static extern bool GetVolumeInformationByHandleW(SafeFileHandle h, StringBuilder volume, uint vlen, out uint serial, out uint max, out uint flags, StringBuilder fs, uint fslen);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] internal static extern uint GetDriveTypeW(string root);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] internal static extern uint GetFinalPathNameByHandleW(SafeFileHandle h, StringBuilder path, uint size, uint flags);
    internal static Exception Error(string operation) { return new IOException(operation + " denied (Win32 " + Marshal.GetLastWin32Error() + ")"); }
    internal static Info Inspect(SafeFileHandle h) {
        Info i; if (!GetFileInformationByHandle(h, out i)) throw Error("inspect");
        if ((i.Attributes & (0x400u | 0x40u)) != 0) throw new IOException("Reparse point or device denied");
        return i;
    }
    internal static string Identity(Info i) { return i.Volume.ToString("X8") + ":" + i.IndexHigh.ToString("X8") + i.IndexLow.ToString("X8"); }
    internal static string VolumePath(SafeFileHandle directory) {
        var path = new StringBuilder(1024);
        // VOLUME_NAME_GUID identifies the mounted volume without re-resolving a DOS drive alias.
        uint length = GetFinalPathNameByHandleW(directory, path, 1024, 1);
        if (length == 0 || length >= 1024 || !path.ToString().StartsWith("\\\\?\\Volume{", StringComparison.OrdinalIgnoreCase))
            throw new IOException("Unable to bind transaction to the directory's volume");
        return path.ToString().TrimEnd('\\');
    }
    internal static SafeFileHandle Open(SafeFileHandle parent, string name, bool directory, bool mutate, uint disposition, bool writable) {
        IntPtr text = Marshal.StringToHGlobalUni(name), usPtr = IntPtr.Zero;
        try {
            US us = new US { Length = checked((ushort)(name.Length * 2)), MaximumLength = checked((ushort)(name.Length * 2)), Buffer = text };
            usPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(US))); Marshal.StructureToPtr(us, usPtr, false);
            OA oa = new OA { Length = Marshal.SizeOf(typeof(OA)), Root = parent.DangerousGetHandle(), Name = usPtr, Attributes = 0x40 };
            IOS io; SafeFileHandle h;
            // One component only; open the reparse object itself, never follow it.
            int status = NtCreateFile(out h, Read | 0x100000u | (mutate ? Delete : 0) | (writable ? Write : 0), ref oa, out io, IntPtr.Zero, 0, directory ? DirectoryShare : 1u, disposition, 0x200000u | 0x20u | (directory ? 1u : 0x40u), IntPtr.Zero, 0);
            if (status < 0) { if (h != null) h.Dispose(); if ((uint)status == 0xC0000034u) throw new FileNotFoundException(); throw new IOException("Relative open denied (NTSTATUS " + ((uint)status).ToString("X8") + ")"); }
            try { Info info = Inspect(h); if (!directory && info.Links != 1) throw new IOException("Hard links denied"); return h; } catch { h.Dispose(); throw; }
        } finally { Marshal.FreeHGlobal(text); if (usPtr != IntPtr.Zero) Marshal.FreeHGlobal(usPtr); }
    }
    internal static void Rename(SafeFileHandle source, SafeFileHandle parent, string name) {
        byte[] text = Encoding.Unicode.GetBytes(name); IntPtr p = Marshal.AllocHGlobal(20 + text.Length);
        try {
            for (int i=0; i<20; i++) Marshal.WriteByte(p,i,0);
            Marshal.WriteInt32(p, 0); // Never replace a destination name. Overwrites use TxF handles.
            Marshal.WriteIntPtr(p,8,parent.DangerousGetHandle()); Marshal.WriteInt32(p,16,text.Length); Marshal.Copy(text,0,IntPtr.Add(p,20),text.Length);
            IOS io; int status = NtSetInformationFile(source,out io,p,(uint)(20+text.Length),65);
            if (status < 0) throw new IOException("Handle rename denied (NTSTATUS " + ((uint)status).ToString("X8") + ")");
        } finally { Marshal.FreeHGlobal(p); }
    }
    internal static void Remove(SafeFileHandle h) {
        IntPtr p = Marshal.AllocHGlobal(1); try { Marshal.WriteByte(p,1); IOS io; int status = NtSetInformationFile(h,out io,p,1,13); if (status<0) throw new IOException("Handle delete denied (NTSTATUS " + ((uint)status).ToString("X8") + ")"); } finally { Marshal.FreeHGlobal(p); }
    }
}

sealed class FileTransaction : IDisposable {
    const uint WriteAttributes = 0x100;
    const uint OpenReparseDirectory = 0x02200000;
    readonly SafeFileHandle handle;
    readonly List<SafeFileHandle> files = new List<SafeFileHandle>();
    readonly HashSet<string> pinned = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    bool finished;

    internal FileTransaction() {
        Program.CheckTransactionAvailable();
        handle = Native.CreateTransaction(IntPtr.Zero, IntPtr.Zero, 0, 0, 0, 20000, "Emma workspace operation");
        if (handle.IsInvalid) {
            var error = Native.Error("NTFS transaction unavailable; no fallback");
            handle.Dispose();
            throw error;
        }
    }

    internal SafeFileHandle Open(string path, bool write, bool create) {
        uint access = Native.Read | Native.Delete | WriteAttributes | (write ? Native.Write : 0);
        // Always exclude existing data readers, too. A concurrent reader can otherwise
        // defer the actual deletion until after the transaction commits.
        var file = Native.CreateFileTransactedW(path, access, 0, IntPtr.Zero, create ? 1u : 3u,
            OpenReparseDirectory, IntPtr.Zero, handle, IntPtr.Zero, IntPtr.Zero);
        if (file.IsInvalid) {
            int error = Marshal.GetLastWin32Error();
            file.Dispose();
            if (error == 2) throw new FileNotFoundException();
            throw new IOException("Transactional open denied (Win32 " + error + ")");
        }
        files.Add(file);
        return file;
    }

    internal string ChildPath(SafeFileHandle expected, string name) {
        string path = Native.VolumePath(expected);
        if (files.Contains(expected) || pinned.Contains(path)) return path + "\\" + name;
        // Share modes do NOT exclude FILE_WRITE_ATTRIBUTES-only handles. Enlist the
        // immediate parent as a TxF writer before any full-path create/open. Ancestors
        // retain their pinned next component, so NTFS cannot turn them into reparses.
        // Opening the parent itself uses OPEN_REPARSE_POINT and verifies its identity.
        var directory = Native.CreateFileTransactedW(path, Native.Read | WriteAttributes, 1, IntPtr.Zero, 3,
            OpenReparseDirectory, IntPtr.Zero, handle, IntPtr.Zero, IntPtr.Zero);
        if (directory.IsInvalid) {
            var error = Native.Error("Transactional parent lock");
            directory.Dispose();
            throw error;
        }
        files.Add(directory);
        var actual = Native.Inspect(directory);
        var original = Native.Inspect(expected);
        if ((actual.Attributes & 16) == 0 || Native.Identity(actual) != Native.Identity(original))
            throw new IOException("Parent identity changed");
        pinned.Add(path);
        return path + "\\" + name;
    }

    internal void CreateDirectory(string path) {
        Program.Checkpoint("PARENTS");
        if (!Native.CreateDirectoryTransactedW(null, path, IntPtr.Zero, handle))
            throw Native.Error("Transactional directory create");
        Program.AfterMutation();
    }

    void CloseFiles() {
        for (int i = files.Count - 1; i >= 0; i--) files[i].Dispose();
        files.Clear();
    }

    internal void Commit() {
        CloseFiles();
        Program.Checkpoint("COMMIT");
        if (!Native.CommitTransaction(handle)) throw Native.Error("Transaction commit");
        finished = true;
    }

    public void Dispose() {
        CloseFiles();
        try {
            if (!finished && !Native.RollbackTransaction(handle)) throw Native.Error("Transaction rollback");
        } finally {
            handle.Dispose();
        }
    }
}

sealed class Proxy : IDisposable {
    sealed class Entry { internal string Path; internal SafeFileHandle Handle; internal Native.Info Info; internal bool Directory { get { return (Info.Attributes & 16) != 0; } } }
    readonly Dictionary<string,Entry> opened = new Dictionary<string,Entry>(StringComparer.OrdinalIgnoreCase);
    readonly List<Entry> order = new List<Entry>();
    readonly string root; readonly string[] protectedRoots; readonly Entry rootEntry;
    readonly FileTransaction transaction;
    const int MaxFile = 8*1024*1024, MaxTree = 2000;
    static readonly UTF8Encoding Utf8 = new UTF8Encoding(false,true);
    internal Proxy(string selected, string identity, string[] excluded, bool transactional) {
        Native.DirectoryShare=transactional?1u:3u;
        root = Normalize(selected, null); protectedRoots = excluded;
        if (root.Length == 3) throw new IOException("Drive root denied");
        rootEntry = Resolve(root,false,true);
        if (identity != "" && identity != Native.Identity(rootEntry.Info)) throw new IOException("Workspace identity changed");
        if(transactional) transaction=new FileTransaction();
    }
    internal string Identity { get { return Native.Identity(rootEntry.Info); } }
    static bool Within(string parent,string path) { return path.Equals(parent,StringComparison.OrdinalIgnoreCase) || path.StartsWith(parent.TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase); }
    internal static string Normalize(string input,string root) {
        if (String.IsNullOrEmpty(input) || input.Length>240 || input.StartsWith("\\") || input.StartsWith("/")) throw new IOException("Unsupported path");
        string s=input.Replace('/','\\'); bool abs=s.Length>=3 && Char.IsLetter(s[0]) && s[1]==':' && s[2]=='\\';
        string rest=abs ? s.Substring(3) : s;
        if (rest.IndexOfAny(new char[]{':','*','?','"','<','>','|'})>=0) throw new IOException("ADS or special path denied");
        foreach(char c in s) if(c<32) throw new IOException("Control character denied");
        foreach(string component in rest.Split('\\')) {
            if(component=="." || component==".." || component=="") continue;
            if(component.EndsWith(".") || component.EndsWith(" ") || System.Text.RegularExpressions.Regex.IsMatch(component,@"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)",System.Text.RegularExpressions.RegexOptions.IgnoreCase)) throw new IOException("Device or ambiguous name denied");
        }
        if(!abs && root==null) throw new IOException("Absolute workspace required");
        string path=Path.GetFullPath(abs?s:Path.Combine(root,s)).TrimEnd('\\'); if(path.Length==2) path+="\\";
        if(path.Length>240) throw new IOException("Path too long"); return path;
    }
    string PathFor(string input,bool write) {
        string p=Normalize(input,root);
        foreach(string excluded in protectedRoots) if(Within(Normalize(excluded,null),p)) throw new IOException("Protected application directory denied");
        if(write && (!Within(root,p) || p.Equals(root,StringComparison.OrdinalIgnoreCase))) throw new IOException("Outside write or workspace root operation denied");
        return p;
    }
    Entry Keep(string path,SafeFileHandle h) {
        try {
            Entry e=new Entry {Path=path,Handle=h,Info=Native.Inspect(h)};
            var final=new StringBuilder(1024); uint length=Native.GetFinalPathNameByHandleW(h,final,1024,0);
            if(length==0 || length>=1024 || !final.ToString().StartsWith("\\\\?\\") || !final.ToString().Substring(4).TrimEnd('\\').Equals(path.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase)) throw new IOException("Path alias or redirection denied");
            if(e.Directory) { IntPtr flags=Marshal.AllocHGlobal(4); try { if(!Native.GetFileInformationByHandleEx(h,23,flags,4)) throw Native.Error("Case sensitivity query"); if(Marshal.ReadInt32(flags)!=0) throw new IOException("Case sensitive directories unsupported"); } finally {Marshal.FreeHGlobal(flags);} }
            opened.Add(path,e); order.Add(e); return e;
        } catch {h.Dispose();throw;}
    }
    Entry Resolve(string path,bool mutate,bool directory) {
        Entry cached; if(opened.TryGetValue(path,out cached)) return cached;
        if(path.Length==3) {
            if(Native.GetDriveTypeW(path)!=3) throw new IOException("Only fixed local volumes supported");
            SafeFileHandle h=Native.CreateFileW("\\\\?\\"+path,Native.Read,Native.DirectoryShare,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
            if(h.IsInvalid) {h.Dispose();throw Native.Error("Volume open");}
            try { uint serial,max,flags; var fs=new StringBuilder(32); if(!Native.GetVolumeInformationByHandleW(h,null,0,out serial,out max,out flags,fs,32) || fs.ToString()!="NTFS") throw new IOException("Only local NTFS supported"); return Keep(path,h); } catch {h.Dispose();throw;}
        }
        Entry parent=Resolve(Path.GetDirectoryName(path),false,true);
        return Keep(path,Native.Open(parent.Handle,Path.GetFileName(path),directory,mutate,1,false));
    }
    Entry Existing(string path,bool mutate,bool contentWrite = false) {
        // Query type using a handle, not path metadata; reopen never follows a reparse point.
        Entry cached; if(opened.TryGetValue(path,out cached)) return cached;
        Entry parent=Resolve(Path.GetDirectoryName(path),false,true);
        if(mutate && transaction!=null) {
            string target = transaction.ChildPath(parent.Handle, Path.GetFileName(path));
            var handle=transaction.Open(target,contentWrite,false); var info=Native.Inspect(handle);
            if((info.Attributes&16)==0 && info.Links!=1)throw new IOException("Hard links denied");
            return Keep(path,handle);
        }
        SafeFileHandle h;
        try {h=Native.Open(parent.Handle,Path.GetFileName(path),false,mutate,1,false);}
        catch(IOException ex) { if(!ex.Message.Contains("C00000BA")) throw; h=Native.Open(parent.Handle,Path.GetFileName(path),true,mutate,1,false); }
        return Keep(path,h);
    }
    byte[] Bytes(Entry e) {
        if(e.Directory || e.Info.SizeHigh!=0 || e.Info.SizeLow>MaxFile) throw new IOException("File exceeds 8 MiB");
        byte[] bytes=new byte[e.Info.SizeLow]; uint n; if(!Native.ReadFile(e.Handle,bytes,(uint)bytes.Length,out n,IntPtr.Zero) || n!=bytes.Length) throw Native.Error("Read"); return bytes;
    }
    string Text(byte[] bytes) { if(bytes.Length>512*1024 || Array.IndexOf(bytes,(byte)0)>=0) throw new IOException("Not bounded UTF-8 text"); return Utf8.GetString(bytes); }
    string Preview(byte[] bytes) { try{return Text(bytes);} catch{return "[binary " + bytes.Length + " bytes]";} }
    List<Entry> Tree(Entry start,bool mutate,int depth) {
        if(depth>12) throw new IOException("Tree depth limit"); var result=new List<Entry>(); if(!start.Directory) return result;
        IntPtr p=Marshal.AllocHGlobal(65536);
        try {
            bool first=true;
            while(true) {
                if(!Native.GetFileInformationByHandleEx(start.Handle,first?11:10,p,65536)) {if(Marshal.GetLastWin32Error()==18) break; throw Native.Error("Directory enumeration");} first=false;
                int offset=0;
                while(true) {
                    IntPtr item=IntPtr.Add(p,offset); int next=Marshal.ReadInt32(item), len=Marshal.ReadInt32(item,60);
                    if(len<0 || len>480 || offset+104+len>65536) throw new IOException("Invalid directory entry");
                    string name=Marshal.PtrToStringUni(IntPtr.Add(item,104),len/2);
                    if(name!="." && name!="..") {
                        if(order.Count>MaxTree) throw new IOException("Tree count limit");
                        string child=PathFor(Path.Combine(start.Path,name),false); Entry e=Existing(child,mutate);
                        ulong id=unchecked((ulong)Marshal.ReadInt64(item,96)); if(id!=(((ulong)e.Info.IndexHigh<<32)|e.Info.IndexLow)) throw new IOException("Directory entry identity changed");
                        result.Add(e); result.AddRange(Tree(e,mutate,depth+1));
                    }
                    if(next==0) break; if(next<104 || offset+next>=65536) throw new IOException("Invalid directory offset"); offset+=next;
                }
            }
        } finally {Marshal.FreeHGlobal(p);} return result;
    }
    void Atomic(string target,byte[] bytes,Entry old) {
        if(transaction==null)throw new IOException("Transactional write required");
        var parent=Resolve(Path.GetDirectoryName(target),false,true);
        string boundTarget = transaction.ChildPath(parent.Handle, Path.GetFileName(target));
        Program.Checkpoint("PARENTS");
        Entry entry=old??Keep(target,transaction.Open(boundTarget,true,true));
        if(entry.Directory || entry.Info.Links!=1)throw new IOException("Not a single-link regular file");
        // The same transacted writer handle is checked, read and written. No name-based replace.
        Program.Checkpoint();
        long position;uint n;
        if(!Native.SetFilePointerEx(entry.Handle,0,out position,0) || !Native.WriteFile(entry.Handle,bytes,(uint)bytes.Length,out n,IntPtr.Zero) || n!=bytes.Length || !Native.SetEndOfFile(entry.Handle) || !Native.FlushFileBuffers(entry.Handle)) throw Native.Error("Transactional write/flush");
        Program.AfterMutation();
    }
    static string Arg(Dictionary<string,object> a,string k) {object v; if(!a.TryGetValue(k,out v) || !(v is string)) throw new IOException("Missing argument");return (string)v;}
    internal object Run(string op,Dictionary<string,object> a) {
        if(op=="identity") return Identity;
        bool mutate=op=="write_file" || op=="apply_patch" || op=="delete_path" || op=="move_path" || op=="rename_path" || op=="create_directory";
        string path=PathFor(Arg(a,"path"),mutate);
        if(op=="create_directory") {
            var parent = Resolve(Path.GetDirectoryName(path), false, true);
            string target = transaction.ChildPath(parent.Handle, Path.GetFileName(path));
            transaction.CreateDirectory(target);
            Keep(path, transaction.Open(target, false, false));
            return Result("Directory created", path, "", "[directory]");
        }
        Entry e=null; try {e=path.Equals(root,StringComparison.OrdinalIgnoreCase)?rootEntry:Existing(path,mutate,op=="write_file" || op=="apply_patch");} catch(FileNotFoundException) {if(op!="write_file") throw;}
        if(op=="read_file") return Text(Bytes(e));
        if(op=="stat_path") return new {path=path,size=((ulong)e.Info.SizeHigh<<32)|e.Info.SizeLow,directory=e.Directory,links=e.Info.Links,identity=Native.Identity(e.Info)};
        if(op=="write_file" || op=="apply_patch") {
            byte[] before=e==null?new byte[0]:Bytes(e); string content;
            if(op=="apply_patch") {string text=Text(before), old=Arg(a,"oldText"), replacement=Arg(a,"newText"); int i=text.IndexOf(old,StringComparison.Ordinal); if(old.Length==0 || i<0 || text.IndexOf(old,i+old.Length,StringComparison.Ordinal)>=0) throw new IOException("Patch must match exactly once"); content=text.Substring(0,i)+replacement+text.Substring(i+old.Length);}
            else content=Arg(a,"content");
            byte[] data=Utf8.GetBytes(content); if(data.Length>512*1024) throw new IOException("Text size limit"); Atomic(path,data,e); return Result("File written",path,Preview(before),content);
        }
        if(op=="list_directory" || op=="find_files" || op=="search_files" || op=="walk") {
            var tree=Tree(e,false,0); var result=new List<string>(); int bytes=0;
            foreach(var entry in tree) {
                if(op=="walk") result.Add(entry.Path);
                else if(op=="list_directory") {if(Path.GetDirectoryName(entry.Path)==path) result.Add(Path.GetFileName(entry.Path));}
                else if(op=="find_files") {string query=Arg(a,"query"); string regex="^"+System.Text.RegularExpressions.Regex.Escape(query).Replace("\\*",".*")+"$"; if(System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(entry.Path),regex,System.Text.RegularExpressions.RegexOptions.IgnoreCase)) result.Add(entry.Path);}
                else if(!entry.Directory) {if(entry.Info.SizeHigh!=0 || entry.Info.SizeLow>512*1024)continue; byte[] data=Bytes(entry); bytes+=data.Length; if(bytes>MaxFile)throw new IOException("Search size limit"); string text;try{text=Text(data);}catch{continue;} string[] lines=text.Split('\n'); for(int i=0;i<lines.Length && result.Count<100;i++)if(lines[i].Contains(Arg(a,"query")))result.Add(entry.Path+":"+(i+1)+": "+lines[i].Substring(0,Math.Min(500,lines[i].Length)));}
                if((op=="find_files" || op=="search_files") && result.Count>=100)break;
            } return result;
        }
        if(op=="delete_path" || op=="move_path" || op=="rename_path") {
            var children=Tree(e,true,0); // all identities and sharing locks acquired before first mutation
            Program.Checkpoint();
            if(op!="delete_path") {string dest=PathFor(Arg(a,"destination"),true); if(Within(path,dest))throw new IOException("Move into source denied"); var parent=Resolve(Path.GetDirectoryName(dest),false,true);
                // Windows refuses directory rename with open descendant handles. Release only
                // descendants, never source/ancestors. Rename acts on the source handle and does
                // not traverse descendants, even if another process adds a link after inspection.
                foreach(var child in children)child.Handle.Dispose();
                Native.Rename(e.Handle,parent.Handle,Path.GetFileName(dest)); return Result("Moved",path,path,dest);}
            string before=e.Directory?"[directory tree]":Preview(Bytes(e));
            children.Reverse(); foreach(var child in children){Native.Remove(child.Handle);child.Handle.Dispose();Program.AfterMutation();} Native.Remove(e.Handle);Program.AfterMutation();return Result("Deleted",path,before,"");
        }
        if(op=="copy_path") {
            string dest=PathFor(Arg(a,"destination"),true); if(Within(path,dest))throw new IOException("Copy into source denied");
            var tree=Tree(e,false,0); var contents=new Dictionary<Entry,byte[]>(); int total=0;
            var entries=new List<Entry>{e};entries.AddRange(tree);foreach(var item in entries)if(!item.Directory){var data=Bytes(item);total+=data.Length;if(total>MaxFile)throw new IOException("Copy size limit");contents.Add(item,data);}
            // Directory copies require a new destination. All source bytes are read before mutation.
            foreach (var item in entries) {
                string output = item == e ? dest : PathFor(dest + item.Path.Substring(path.Length), true);
                if (item.Directory) {
                    var parent = Resolve(Path.GetDirectoryName(output), false, true);
                    string target = transaction.ChildPath(parent.Handle, Path.GetFileName(output));
                    transaction.CreateDirectory(target);
                    Keep(output, transaction.Open(target, false, false));
                } else {
                    Entry old = null;
                    try { old = Existing(output, true, true); } catch (FileNotFoundException) { }
                    Atomic(output, contents[item], old);
                }
            }
            return Result("Copied",dest,"",e.Directory?"[directory tree]":Preview(contents[e]));
        }
        throw new IOException("Unknown operation");
    }
    object Result(string message,string path,string before,string after) {return new {message=message,change=new {path=path,operation="filesystem",before=before,after=after}};}
    internal void Commit(){if(transaction!=null)transaction.Commit();}
    public void Dispose(){try{if(transaction!=null)transaction.Dispose();}finally{for(int i=order.Count-1;i>=0;i--)order[i].Handle.Dispose();}}
}
static class Program {
#if TEST_HOOKS
    internal static string Barrier="LOCKED";
    internal static int FailAfter=0,Mutations=0;
    internal static bool TransactionUnavailable=false;
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool DeviceIoControl(SafeFileHandle h,uint code,byte[] input,uint length,IntPtr output,uint size,out uint returned,IntPtr overlap);
    static void MakeUnknown(string path,uint access) {
        using(var h=Native.CreateFileW(path,access,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
            if(h.IsInvalid)throw Native.Error("fixture open");
            byte[] data=new byte[24];BitConverter.GetBytes((uint)0x42).CopyTo(data,0);Guid.NewGuid().ToByteArray().CopyTo(data,8);
            uint returned;if(!DeviceIoControl(h,0x900A4,data,(uint)data.Length,IntPtr.Zero,0,out returned,IntPtr.Zero))throw Native.Error("fixture reparse");
        }
    }
#endif
    internal static void Checkpoint(string phase="LOCKED") {
#if TEST_HOOKS
        if(phase!=Barrier)return;
        Console.Error.WriteLine("LOCKED"); Console.Error.Flush();
        if(Console.In.ReadLine()!="GO") throw new IOException("Test barrier aborted");
#endif
    }
    internal static void AfterMutation(){
#if TEST_HOOKS
        Mutations++;if(FailAfter>0 && Mutations==FailAfter)throw new IOException("Injected failure after mutation "+Mutations);
        Checkpoint("MUTATION");
#endif
    }
    internal static void CheckTransactionAvailable(){
#if TEST_HOOKS
        if(TransactionUnavailable)throw new IOException("NTFS transaction unavailable; no fallback");
#endif
    }
    static void Main(string[] args) {
#if TEST_HOOKS
        if(args.Length>=2 && args[0]=="--unknown-reparse") {try{MakeUnknown(args[1],args.Length==3?Convert.ToUInt32(args[2]):Native.Read|Native.Write);}catch(Exception e){Console.Error.Write(e.Message);Environment.ExitCode=1;}return;}
#endif
        Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
        var json=new JavaScriptSerializer {MaxJsonLength=4*1024*1024};
        try {var sb=new StringBuilder();int c;while((c=Console.In.Read())>=0 && c!='\n'){sb.Append((char)c);if(sb.Length>2*1024*1024)throw new IOException("Request too large");}
            var request=json.Deserialize<Dictionary<string,object>>(sb.ToString()); var excluded=new List<string>();foreach(object p in (System.Collections.ArrayList)request["protectedRoots"])excluded.Add((string)p);
#if TEST_HOOKS
            if(request.ContainsKey("barrier"))Barrier=(string)request["barrier"];
            if(request.ContainsKey("failAfter"))FailAfter=Convert.ToInt32(request["failAfter"]);
            if(request.ContainsKey("transactionUnavailable"))TransactionUnavailable=(bool)request["transactionUnavailable"];
#endif
            string op=(string)request["op"];bool transacted=op=="write_file" || op=="apply_patch" || op=="copy_path" || op=="delete_path" || op=="create_directory";
            using (var proxy = new Proxy((string)request["root"], (string)request["identity"], excluded.ToArray(), transacted)) {
                object result = proxy.Run(op, (Dictionary<string,object>)request["args"]);
                string reply = json.Serialize(new {ok=true, result=result});
                if (Encoding.UTF8.GetByteCount(reply) > 4 * 1024 * 1024) throw new IOException("Response too large");
                proxy.Commit();
                Console.Write(reply);
            }
        }catch(Exception e){Console.Write(json.Serialize(new {ok=false,error=e is IOException || e is DecoderFallbackException ? e.Message : "Native filesystem proxy failed"}));Environment.ExitCode=1;}
    }
}
