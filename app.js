const { WebSocket, createWebSocketStream, WebSocketServer } = require('ws');
const { createConnection } = require('node:net');
const { createSocket } = require('node:dgram');
const dns = require('node:dns');
const { promisify } = require('node:util');

const PORT = "3000";
const dnsResolver = new dns.Resolver();
dnsResolver.setServers(['1.1.1.1']);
const resolve4 = promisify(dnsResolver.resolve4.bind(dnsResolver));
const resolve6 = promisify(dnsResolver.resolve6.bind(dnsResolver));

const res = async (hostname) => {
    const ipv6 = await resolve6(hostname).catch(() => null);
    const ipv4 = await resolve4(hostname).catch(() => null);
    return (ipv4 && ipv4[0]) || (ipv6 && ipv6[0]) || hostname;
};

const Protocols = { tcp: 1, udp: 2, mux: 3 };
const NameProtocols = Object.fromEntries(Object.entries(Protocols).map(([k,v]) => [v,k]));

const BUFFER_SUCCESS = Buffer.from([0, 0]);
const BUFFER_META = Buffer.allocUnsafe(64);
const BUFFER_LEN = Buffer.allocUnsafe(2);
let idHelper = 0;
const wss = new WebSocketServer({ port: PORT, host: "0.0.0.0" });

wss.on("connection", (socket) => {
    const socketSessions = {};
    socket.buffer = [];
    socket.id = idHelper++;
    socket.on("message", async (data) => {
        socket.buffer.push(data);
        const combined = Buffer.concat(socket.buffer);
        
        if (combined.length < 24) return;
        socket.buffer = [];

        const version = combined[0];
        const optLength = combined[17];
        const cmd = combined[18 + optLength];
        
        if (cmd === Protocols.mux) {
            socket.send(BUFFER_SUCCESS);
            socket.removeAllListeners("message");
            
            let totalBuffer = Buffer.alloc(0);
            
            socket.on("message", async (data) => {
                totalBuffer = Buffer.concat([totalBuffer, data]);
                
                while (totalBuffer.length >= 2) {
                    const metaLen = totalBuffer.readUInt16BE(0);
                    if (metaLen < 4 || totalBuffer.length < 2 + metaLen) break;
                    
                    const meta = totalBuffer.slice(2, 2 + metaLen);
                    const uid = meta.readUInt16BE(0);
                    const cmd = meta[2];
                    const hasExtra = meta[3] === 1;
                    
                    let extraLen = 0;
                    let extraData;
                    let nextOffset = 2 + metaLen;
                    
                    if (hasExtra) {
                        if (totalBuffer.length < nextOffset + 2) break;
                        extraLen = totalBuffer.readUInt16BE(nextOffset);
                        nextOffset += 2;
                        if (totalBuffer.length < nextOffset + extraLen) break;
                        extraData = totalBuffer.slice(nextOffset, nextOffset + extraLen);
                        nextOffset += extraLen;
                    }

                    const sessionId = `${socket.id}/${uid}`;
                    const session = socketSessions[sessionId];

                    if (cmd === 1) {
                        let offset = 4;
                        const protocol = NameProtocols[meta[offset++]];
                        const port = meta.readUInt16BE(offset);
                        offset += 2;

                        let host;
                        const addressType = meta[offset++];
                        
                        switch (addressType) {
                            case 0x01:
                                host = Array.from(meta.slice(offset, offset + 4)).join('.');
                                offset += 4;
                                break;
                            case 0x02:
                                const size = meta[offset++];
                                host = await res(meta.slice(offset, offset + size).toString())
                                offset += size;
                                break;
                            case 0x03:
                                host = Array.from({length: 8}, (_, i) => 
                                    meta.readUInt16BE(offset + i * 2).toString(16)
                                ).join(':');
                                offset += 16;
                                break;
                        }

                        if (!host || !port) {
                            if (socket.readyState === WebSocket.OPEN) {
                                const header = Buffer.alloc(4);
                                header.writeUInt16BE(uid);
                                header[2] = 3;
                                header[3] = 0;
                                BUFFER_LEN.writeUInt16BE(header.length);
                                socket.send(BUFFER_LEN);
                                socket.send(header);
                            }
                            continue;
                        }
                        if (protocol === 'tcp') {
                            const client = createConnection({ host, port }, () => {
                            });

                            client.setKeepAlive(true);
                            client.setNoDelay(true);

                            client.on("data", (data) => {
                                if (socket.readyState === WebSocket.OPEN) {
                                    let offset = 0;
                                    while (offset < data.length) {
                                        const chunk = data.slice(offset, offset + 65535);
                                        const header = Buffer.alloc(4);
                                        header.writeUInt16BE(uid);
                                        header[2] = 2;
                                        header[3] = 1;
                                        BUFFER_LEN.writeUInt16BE(header.length);
                                        socket.send(BUFFER_LEN);
                                        socket.send(header);
                                        BUFFER_LEN.writeUInt16BE(chunk.length);
                                        socket.send(BUFFER_LEN);
                                        socket.send(chunk);
                                        offset += chunk.length;
                                    }
                                }
                            });

                            client.on("error", () => client.destroy());
                            client.once("close", () => {
                                delete socketSessions[sessionId];
                                if (socket.readyState === WebSocket.OPEN) {
                                    const header = Buffer.alloc(4);
                                    header.writeUInt16BE(uid);
                                    header[2] = 3;
                                    header[3] = 0;
                                    BUFFER_LEN.writeUInt16BE(header.length);
                                    socket.send(BUFFER_LEN);
                                    socket.send(header);
                                }
                            });

                            socketSessions[sessionId] = {
                                send: (data) => client.write(data),
                                close: () => client.destroy()
                            };

                            if (extraData) client.write(extraData);
                        } else if (protocol === 'udp') {
                            const client = createSocket("udp4");
                            let lastActivity = Date.now();

                            client.bind();
                            client.on("message", (data) => {
                                lastActivity = Date.now();
                                if (socket.readyState === WebSocket.OPEN) {
                                    let offset = 0;
                                    while (offset < data.length) {
                                        const chunk = data.slice(offset, offset + 65535);
                                        const header = Buffer.alloc(4);
                                        header.writeUInt16BE(uid);
                                        header[2] = 2;
                                        header[3] = 1;
                                        BUFFER_LEN.writeUInt16BE(header.length);
                                        socket.send(BUFFER_LEN);
                                        socket.send(header);
                                        BUFFER_LEN.writeUInt16BE(chunk.length);
                                        socket.send(BUFFER_LEN);
                                        socket.send(chunk);
                                        offset += chunk.length;
                                    }
                                }
                            });

                            const timer = setInterval(() => {
                                if (Date.now() - lastActivity > 30000) {
                                    client.close();
                                }
                            }, 10000);

                            client.once("close", () => {
                                clearInterval(timer);
                                delete socketSessions[sessionId];
                                if (socket.readyState === WebSocket.OPEN) {
                                    const header = Buffer.alloc(4);
                                    header.writeUInt16BE(uid);
                                    header[2] = 3;
                                    header[3] = 0;
                                    BUFFER_LEN.writeUInt16BE(header.length);
                                    socket.send(BUFFER_LEN);
                                    socket.send(header);
                                }
                            });

                            socketSessions[sessionId] = {
                                send: (data) => {
                                    lastActivity = Date.now();
                                    client.send(data, port, host);
                                },
                                close: () => client.close()
                            };

                            if (extraData) client.send(extraData, port, host);
                        }
                    } else if (cmd === 2) {
                        if (extraData && session) {
                            session.send(extraData);
                        }
                    } else if (cmd === 3) {
                        if (session) {
                            if (extraData) session.send(extraData);
                            session.close();
                            delete socketSessions[sessionId];
                        }
                    }

                    totalBuffer = totalBuffer.slice(nextOffset);
                }
            });

            const initialMetaLen = combined.readUInt16BE(19 + optLength);
            if (initialMetaLen >= 4) {
                socket.emit("message", combined.slice(19 + optLength));
            }
            return;
        }

        let offset = 18 + optLength;
        const protocol = NameProtocols[combined[offset++]];
        const port = combined.readUInt16BE(offset);
        offset += 2;

        let host;
        const addressType = combined[offset++];
        
        switch (addressType) {
            case 0x01:
                host = Array.from(combined.slice(offset, offset + 4)).join('.');
                offset += 4;
                break;
            case 0x02:
                const size = combined[offset++];
                host = await res(combined.slice(offset, offset + size).toString())
                offset += size;
                break;
            case 0x03:
                host = Array.from({length: 8}, (_, i) => 
                    combined.readUInt16BE(offset + i * 2).toString(16)
                ).join(':');
                offset += 16;
                break;
        }

        if (!host || !port) {
            return socket.close();
        }

        socket.removeAllListeners("message");
        socket.send(BUFFER_SUCCESS);

        const headData = combined.slice(offset);

        if (protocol === 'tcp') {
            const client = createConnection({ host, port }, () => {
            });

            client.setKeepAlive(true);
            client.setNoDelay(true);

            client.on("data", (data) => {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(data);
                }
            });

            socket.on("message", (data) => {
                client.write(data);
            });

            if (headData.length > 0) {
                client.write(headData);
            }

            const cleanup = () => {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.close();
                }
                if (!client.destroyed) {
                    client.destroy();
                }
            };

            client.on("error", (error) => {
                cleanup();
            });

            client.on("close", cleanup);
            socket.on("close", cleanup);
            socket.on("error", cleanup);

        } else if (protocol === 'udp') {
            const client = createSocket("udp4");
            let connected = false;
            const waiting = { pendings: [] };

            if (headData.length > 0) {
                waiting.pendings.push(headData);
            }

            client.connect(port, host, () => {
                connected = true;
                let total = 0;
                for (const one of waiting.pendings) {
                    total += one.length;
                }
                
                let buffer;
                if (waiting.pendings.length === 1) {
                    buffer = waiting.pendings.pop();
                } else {
                    buffer = Buffer.allocUnsafe(total);
                    let offset = 0;
                    while (waiting.pendings.length > 0) {
                        const one = waiting.pendings.shift();
                        offset += one.copy(buffer, offset, 0, one.length);
                    }
                }

                if (buffer) {
                    const length = buffer.readUInt16BE(0); 
                    if (2 + length <= buffer.length) {
                        client.send(buffer.subarray(2, 2 + length), port, host); 
                        if (2 + length < buffer.length) {
                            waiting.pendings.push(buffer.subarray(2 + length));
                        }
                    } else {
                        waiting.pendings.push(buffer);
                    }
                }
            });

            client.on("message", (data) => {
                let offset = 0;
                while (offset < data.length) {
                    const len = Math.min(data.length - offset, 65535);
                    BUFFER_LEN.writeUInt16BE(len);
                    socket.send(BUFFER_LEN);
                    socket.send(data.subarray(offset, offset += len));
                }
            });

            socket.on("message", (data) => {
                waiting.pendings.push(data);
                if (connected) {
                    let total = 0;
                    for (const one of waiting.pendings) {
                        total += one.length;
                    }
                    
                    let buffer;
                    if (waiting.pendings.length === 1) {
                        buffer = waiting.pendings.pop();
                    } else {
                        buffer = Buffer.allocUnsafe(total);
                        let offset = 0;
                        while (waiting.pendings.length > 0) {
                            const one = waiting.pendings.shift();
                            offset += one.copy(buffer, offset, 0, one.length);
                        }
                    }

                    if (buffer) {
                        const length = buffer.readUInt16BE(0)
                        if (2 + length <= buffer.length) {
                            client.send(buffer.subarray(2, 2 + length), port, host);
                            if (2 + length < buffer.length) {
                                waiting.pendings.push(buffer.subarray(2 + length));
                            }
                        } else {
                            waiting.pendings.push(buffer);
                        }
                    }
                }
            });

            client.on("error", () => {
                client.close();
            });

            client.once("close", () => {
                connected = false;
                if (socket.readyState === WebSocket.OPEN) {
                    socket.close();
                }
            });

            socket.on("error", () => {
                socket.close();
            });

            socket.once("close", () => {
                client.close();
            });
        }
    });

    socket.on("close", () => {
        Object.values(socketSessions).forEach(session => session.close());
    });
});

wss.on("listening", () => {});
wss.on("error", () => {});
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
