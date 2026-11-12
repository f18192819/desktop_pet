/** 增量 SSE 解析：UTF-8 由调用方流式解码；支持 CR/LF/CRLF、多行 data、注释及跨块边界。 */
export class SSEParser {
  private buffer = '';
  private data: string[] = [];
  private size = 0;
  feed(text: string, final = false): string[] {
    this.buffer += text;
    const events: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = /\r\n|\r|\n/.exec(this.buffer))) {
      if (!final && match[0] === '\r' && match.index === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      this.line(line, events);
    }
    if (this.buffer.length + this.size > 1_048_576) throw new Error('SSE 数据块过大');
    if (final) { if (this.buffer) this.line(this.buffer, events); this.buffer = ''; this.line('', events); }
    return events;
  }
  private line(line: string, events: string[]) {
    if (!line) {
      if (this.data.length) events.push(this.data.join('\n'));
      this.data = []; this.size = 0;
    } else if (line === 'data' || line.startsWith('data:')) {
      const value = line === 'data' ? '' : line.slice(5).replace(/^ /, '');
      this.data.push(value); this.size += value.length;
      if (this.size > 1_048_576) throw new Error('SSE 数据块过大');
    }
  }
}
