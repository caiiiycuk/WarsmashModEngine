// @ts-ignore
import WebRTCNet from "./webrtcnet.mjs";

/* eslint-disable-next-line new-cap */
const webrtcnet: Promise<any> = WebRTCNet();

type Peer ={
    peerId: number;
}

export type Net = {
    peerId: number;
    connected: Set<number>;
    wait: (ms: number) => void;
    registerAlias: (alias: string) => Promise<void>;
    unregisterAlias: (alias: string) => void;
    queryAliases: (query: string) => Promise<Peer[]>;
    sendBinary: (data: Uint8Array, peerId: number) => number;
    recvBinary: () => { data: Uint8Array, peerId: number } | null;
    sendEcho: (peerId: number) => void;
    recvEcho: () => number | null;
}

const echo = new Uint8Array([21, 42]);
const echoAck = new Uint8Array([63])

export async function createNet(url: string, token: string, secret: string,
                                onNetworkError: (peerId: number) => void,
                                onDisconnect: () => void,
) {
    console.log("waiting for netConfig");
    window.addEventListener('message', (e) => {
        if (e.data.event === 'mp.room.netConfig') {
            (window as any).netConfig = e.data.netConfig;
        }
    });
    if (window.top) {
      window.top.postMessage({ event: "mp.room.createHumbleNet" }, "*");
    }
    while ((window as any).netConfig === undefined) {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    console.log("netConfig received");
    const cfg = (window as any).netConfig ?? {};
    url = url || cfg.url || cfg.serverUrl || '';
    token = token || cfg.token || '';
    secret = secret || cfg.secret || '';

    const lib = await webrtcnet;
    lib.onNetworkError = onNetworkError;

    const withStr = (str: string, callback: (ptr: number, size: number) => void) => {
        const size = lib.lengthBytesUTF8(str) + 1;
        const ptr = lib.stringToNewUTF8(str);
        callback(ptr, size);
        lib._free(ptr);
    };

    const withBuffer = (buffer: Uint8Array, callback: (ptr: number, size: number) => number) => {
        const size = buffer.byteLength;
        const ptr = lib._malloc(size);
        lib.HEAPU8.set(buffer, ptr);
        const response = callback(ptr, size);
        lib._free(ptr);
        return response;
    };

    const pendingQueries: {
        [query: string]: {
            promise: Promise<{ alias: string, peerId: number }[]>,
            matches: { alias: string, peerId: number }[],
            resolve: (matches: { alias: string, peerId: number }[]) => void
        }
    } = {};

    lib.aliasQueryAdd = (query: string, alias: string, peerId: number) => {
        pendingQueries[query].matches.push({ alias, peerId });
    };

    lib.onAliasQueryEnd = (query: string) => {
        pendingQueries[query].resolve(pendingQueries[query].matches);
        delete pendingQueries[query];
    };

    return new Promise<Net>((resolve, reject) => {
        withStr(url, (urlPtr) => {
            withStr(token, (tokenPtr) => {
                withStr(secret, (secretPtr) => {
                    try {
                        if (lib._connectTo(urlPtr, tokenPtr, secretPtr)) {
                            const recvLength = 4096 * 1024;
                            const recvBuffer = lib._malloc(recvLength);
                            const recvPeerId = lib._malloc(4);
                            const net: Net & { lib: any } = {
                                lib,
                                peerId: 0,
                                connected: new Set(),
                                wait: (ms: number) => {
                                    lib._wait(ms);
                                },
                                registerAlias: (alias: string) => {
                                    if (lib.pendingRegister) {
                                        return Promise.reject(new Error("Register already in progress"));
                                    }

                                    lib.pendingRegister = new Promise<void>((resolve, reject) => {
                                        withStr(alias, (aliasPtr) => {
                                            lib._registerAlias(aliasPtr);
                                        });

                                        net.queryAliases("=" + alias)
                                            .then((aliases) => {
                                                if (aliases.length === 1 && aliases[0].peerId === net.peerId) {
                                                    resolve();
                                                } else {
                                                    reject(new Error("Alias already in use"));
                                                }
                                            })
                                            .catch(reject);
                                    });


                                    return lib.pendingRegister.finally(() => {
                                        lib.pendingRegister = null;
                                    });
                                },
                                unregisterAlias: (alias: string) => {
                                    withStr(alias, (aliasPtr) => {
                                        lib._unregisterAlias(aliasPtr);
                                    });
                                },
                                queryAliases: (query: string) => {
                                    if (pendingQueries[query] !== undefined) {
                                        return pendingQueries[query].promise;
                                    }

                                    pendingQueries[query] = {
                                        matches: [],
                                    } as any;
                                    pendingQueries[query].promise = new Promise<{ alias: string, peerId: number }[]>((resolve) => {
                                        pendingQueries[query].resolve = resolve;

                                        withStr(query, (queryPtr) => {
                                            lib._queryAliases(queryPtr);
                                        });

                                    });

                                    return pendingQueries[query].promise;
                                },
                                sendBinary: (data: Uint8Array, peerId: number) => {
                                    if (peerId === net.peerId || peerId === 0) {
                                        throw new Error("Cannot send to self (" + peerId + ")");
                                    }
                                    net.connected.add(peerId);
                                    return withBuffer(data, (ptr, size) => {
                                        return lib._sendto(ptr, size, peerId, 0);
                                    });
                                },
                                recvBinary: () => {
                                    const ret = lib._recvfrom(recvBuffer, recvLength, recvPeerId);
                                    const peerId = lib.HEAP32[recvPeerId / 4];
                                    if (ret < 0) {
                                        if (peerId !== 0) {
                                            net.connected.delete(peerId);
                                        }
                                        return null;
                                    } else if (ret > 0) {
                                        net.connected.add(peerId);
                                        const data = lib.HEAPU8.slice(recvBuffer, recvBuffer + ret);
                                        if (data.length === echo.length && data[0] === echo[0] && data[1] === echo[1]) {
                                            net.sendBinary(echoAck, peerId);
                                            return net.recvBinary();
                                        }
                                        return { data, peerId };
                                    } else {
                                        return null;
                                    }
                                },
                                sendEcho: (peerId: number) => {
                                    net.sendBinary(echo, peerId);
                                },
                                recvEcho: () => {
                                    const ret = net.recvBinary();
                                    if (ret !== null) {
                                        const { data, peerId } = ret;
                                        if (data.length === echoAck.length && data[0] === echoAck[0]) {
                                            return peerId;
                                        }
                                    }
                                    return null;
                                },
                            };

                            (window as any).net = net;

                            const intervalId = setInterval(() => {
                                net.peerId = lib._myId();
                                if (net.peerId !== 0) {
                                    clearInterval(intervalId);
                                    resolve(net);

                                    const disconnectCheckId = setInterval(() => {
                                        if (lib._myId() === 0) {
                                            onDisconnect();
                                            clearInterval(disconnectCheckId);
                                        }
                                    }, 1000);
                                }
                                net.wait(4);
                            }, 30);
                        } else {
                            reject(new Error("Failed to connect to WebRTCNet"));
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            });
        });
    });
}
