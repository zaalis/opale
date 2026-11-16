// Immutable attachments use a content hash, so a direct transfer can be
// verified before it enters the local cache. Drive remains the durable copy.
import { api, fileUrl } from '../core.js';
const BLOCK = 24 * 1024;
const LIMIT = 24 * 1024 * 1024; // Larger files use Drive without blocking live edits.
const valid = id => /^sha256-[a-f0-9]{64}$/.test(String(id));
export class AssetTransfer {
  constructor(project) { this.project = project; this.requests = new Map(); this.sending = new Set(); }
  request(id) {
    if (!valid(id)) return;
    let request = this.requests.get(id);
    if (request && Date.now() - request.at < 8000) return;
    if (this.requests.size >= 8 && !request) return;
    if (request) clearTimeout(request.timer);
    request = { at: Date.now(), parts: [], peer: '', size: 0, count: 0 };
    request.timer = setTimeout(() => this.requests.delete(id), 30000);
    this.requests.set(id, request);
    for (const link of this.project.mesh.links.values()) if (link.ready) this.project.mesh.raw(link, { k: 'asset-get', id });
  }
  async send(link, id) {
    const key = `${link.peer}:${id}`;
    if (!valid(id) || this.sending.has(key) || this.sending.size >= 2) return;
    this.sending.add(key);
    try {
      const response = await fetch(`${fileUrl(`@shared/${this.project.id}/assets/${id}/attachment`)}&cacheOnly=1`);
      if (!response.ok || Number(response.headers.get('content-length')) > LIMIT) return;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > LIMIT) return;
      const n = Math.max(1, Math.ceil(bytes.length / BLOCK));
      for (let i = 0; i < n; i++) {
        // Keep the shared channel available for typing and gestures.
        while (link.channel.bufferedAmount > 128 * 1024) {
          if (!link.ready || this.project.mesh.closed) return;
          await new Promise(resolve => setTimeout(resolve, 16));
        }
        if (!link.ready || this.project.mesh.closed) return;
        let binary = '';
        for (const byte of bytes.subarray(i * BLOCK, (i + 1) * BLOCK)) binary += String.fromCharCode(byte);
        this.project.mesh.raw(link, { k: 'asset-part', id, i, n, size: bytes.length, data: btoa(binary) });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally { this.sending.delete(key); }
  }
  async receive(link, data) {
    const request = this.requests.get(data.id);
    if (!request || !valid(data.id) || request.receiving) return;
    if (!Number.isInteger(data.size) || data.size < 0 || data.size > LIMIT || data.n !== Math.max(1, Math.ceil(data.size / BLOCK)) || !Number.isInteger(data.i) || data.i < 0 || data.i >= data.n || typeof data.data !== 'string' || data.data.length > BLOCK * 4 / 3 + 4) return;
    if (request.peer && request.peer !== link.peer) return;
    if (!request.peer) { request.peer = link.peer; request.size = data.size; request.n = data.n; }
    if (data.size !== request.size || data.n !== request.n || request.parts[data.i]) return;
    const binary = atob(data.data);
    if (binary.length !== Math.min(BLOCK, data.size - data.i * BLOCK)) return;
    request.parts[data.i] = Uint8Array.from(binary, c => c.charCodeAt(0));
    if (++request.count !== data.n) return;
    request.receiving = true;
    const bytes = new Uint8Array(request.size);
    for (let i = 0; i < request.n; i++) bytes.set(request.parts[i], i * BLOCK);
    try {
      await api(`/api/collab/attachment-cache?project=${encodeURIComponent(this.project.id)}&token=${encodeURIComponent(this.project.token)}&id=${encodeURIComponent(data.id)}`, { method: 'PUT', body: bytes, raw: true });
    } finally { clearTimeout(request.timer); this.requests.delete(data.id); }
  }
  close() { for (const request of this.requests.values()) clearTimeout(request.timer); this.requests.clear(); }
}
