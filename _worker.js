import { connect } from "cloudflare:sockets";

// Variables
let serviceName = "";
let APP_DOMAIN = "";

let prxIP = "";
let cachedPrxList = [];

// Constant
const horse = "dHJvamFu";
const flash = "dm1lc3M=";
const neko = "dmxlc3M=";
const v2 = "djJyYXk=";

const PORTS = [443, 80];
const PROTOCOLS = [atob(horse), atob(flash), atob(neko), "ss"];
const SUB_PAGE_URL = "https://bakulcilor.timeline.eu.org/sub";
const KV_PRX_URL = "https://raw.githubusercontent.com/burnicehomenick/Nautica/refs/heads/main/kvProxyList.json";
const PRX_BANK_URL = "https://raw.githubusercontent.com/burnicehomenick/Nautica/refs/heads/main/proxyList.txt";
const DNS_SERVER_ADDRESS = "8.8.8.8";
const DNS_SERVER_PORT = 53;
const RELAY_SERVER_UDP = {
  host: "udp-relay.hobihaus.space", // Kontribusi atau cek relay publik disini: https://hub.docker.com/r/kelvinzer0/udp-relay
  port: 7300,
};
const CONVERTER_URL = "https://api.foolvpn.web.id/convert";
const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;
const CORS_HEADER_OPTIONS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

// Encrypted Stream Constants (Base64 Encoded)
const SALT_A1 = atob("Vk1lc3MgSGVhZGVyIEFFQUQgS2V5X0xlbmd0aA==");
const SALT_A2 = atob("Vk1lc3MgSGVhZGVyIEFFQUQgTm9uY2VfTGVuZ3Ro");
const SALT_A3 = atob("Vk1lc3MgSGVhZGVyIEFFQUQgS2V5");
const SALT_A4 = atob("Vk1lc3MgSGVhZGVyIEFFQUQgTm9uY2U=");
const SALT_B1 = atob("QUVBRCBSZXNwIEhlYWRlciBMZW4gS2V5");
const SALT_B2 = atob("QUVBRCBSZXNwIEhlYWRlciBMZW4gSVY=");
const SALT_B3 = atob("QUVBRCBSZXNwIEhlYWRlciBLZXk=");
const SALT_B4 = atob("QUVBRCBSZXNwIEhlYWRlciBJVg==");

async function getKVPrxList(kvPrxUrl = KV_PRX_URL) {
  if (!kvPrxUrl) {
    throw new Error("No URL Provided!");
  }

  const kvPrx = await fetch(kvPrxUrl);
  if (kvPrx.status == 200) {
    return await kvPrx.json();
  } else {
    return {};
  }
}

async function getPrxList(prxBankUrl = PRX_BANK_URL) {
  /**
   * Format:
   *
   * <IP>,<Port>,<Country ID>,<ORG>
   * Contoh:
   * 1.1.1.1,443,SG,Cloudflare Inc.
   */
  if (!prxBankUrl) {
    throw new Error("No URL Provided!");
  }

  const prxBank = await fetch(prxBankUrl);
  if (prxBank.status == 200) {
    const text = (await prxBank.text()) || "";

    const prxString = text.split("\n").filter(Boolean);
    cachedPrxList = prxString
      .map((entry) => {
        const [prxIP, prxPort, country, org] = entry.split(",");
        return {
          prxIP: prxIP || "Unknown",
          prxPort: prxPort || "Unknown",
          country: country || "Unknown",
          org: org || "Unknown Org",
        };
      })
      .filter(Boolean);
  }

  return cachedPrxList;
}

async function reverseWeb(request, target, targetPath) {
  const targetUrl = new URL(request.url);
  const targetChunk = target.split(":");

  targetUrl.hostname = targetChunk[0];
  targetUrl.port = targetChunk[1]?.toString() || "443";
  targetUrl.pathname = targetPath || targetUrl.pathname;

  const modifiedRequest = new Request(targetUrl, request);

  modifiedRequest.headers.set("X-Forwarded-Host", request.headers.get("Host"));

  const response = await fetch(modifiedRequest);

  const newResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(CORS_HEADER_OPTIONS)) {
    newResponse.headers.set(key, value);
  }
  newResponse.headers.set("X-Proxied-By", "Cloudflare Worker");

  return newResponse;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      APP_DOMAIN = url.hostname;
      serviceName = APP_DOMAIN.split(".")[0];

      const upgradeHeader = request.headers.get("Upgrade");

      // Handle prx client
      if (upgradeHeader === "websocket") {
        const prxMatch = url.pathname.match(/^\/(.+[:=-]\d+)$/);

        if (url.pathname.length == 3 || url.pathname.match(",")) {
          // Contoh: /ID, /SG, dll
          const prxKeys = url.pathname.replace("/", "").toUpperCase().split(",");
          const prxKey = prxKeys[Math.floor(Math.random() * prxKeys.length)];
          const kvPrx = await getKVPrxList();

          prxIP = kvPrx[prxKey][Math.floor(Math.random() * kvPrx[prxKey].length)];

          return await websocketHandler(request);
        } else if (prxMatch) {
          prxIP = prxMatch[1];
          return await websocketHandler(request);
        }
      }

      if (url.pathname.startsWith("/sub")) {
        return await handleSubPage(request, url, env);
      } else if (url.pathname.startsWith("/check")) {
        const target = url.searchParams.get("target").split(":");
        const result = await checkPrxHealth(target[0], target[1] || "443");

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: {
            ...CORS_HEADER_OPTIONS,
            "Content-Type": "application/json",
          },
        });
      } else if (url.pathname.startsWith("/api/v1")) {
        const apiPath = url.pathname.replace("/api/v1", "");

        if (apiPath.startsWith("/domains")) {
          if (!(env.CF_API_TOKEN && env.CF_ACCOUNT_ID && env.CF_ZONE_ID)) {
            return new Response("API not ready (set CF_API_TOKEN, CF_ACCOUNT_ID, CF_ZONE_ID)", { status: 500 });
          }
          const wildcardApiPath = apiPath.replace("/domains", "");
          const cfApi = new CloudflareApi(env);
          if (wildcardApiPath == "/get") {
            const domains = await cfApi.getDomainList();
            return new Response(JSON.stringify(domains), { headers: { ...CORS_HEADER_OPTIONS } });
          } else if (wildcardApiPath == "/put") {
            const domain2 = url.searchParams.get("domain");
            const register = await cfApi.registerDomain(domain2);
            return new Response(register.toString(), {
              status: register,
              headers: { ...CORS_HEADER_OPTIONS },
            });
          }
        } else if (apiPath.startsWith("/sub")) {
          const filterCC = url.searchParams.get("cc")?.split(",") || [];
          const filterPort = url.searchParams.get("port")?.split(",") || PORTS;
          const filterVPN = url.searchParams.get("vpn")?.split(",") || PROTOCOLS;
          const filterLimit = parseInt(url.searchParams.get("limit")) || 10;
          const filterFormat = url.searchParams.get("format") || "raw";
          const fillerDomain = url.searchParams.get("domain") || APP_DOMAIN;

          const prxBankUrl = url.searchParams.get("prx-list") || env.PRX_BANK_URL;
          const prxList = await getPrxList(prxBankUrl)
            .then((prxs) => {
              // Filter CC
              if (filterCC.length) {
                return prxs.filter((prx) => filterCC.includes(prx.country));
              }
              return prxs;
            })
            .then((prxs) => {
              // shuffle result
              shuffleArray(prxs);
              return prxs;
            });

          const uuid = crypto.randomUUID();
          const result = [];
          for (const prx of prxList) {
            const uri = new URL(`${atob(horse)}://${fillerDomain}`);
            uri.searchParams.set("encryption", "none");
            uri.searchParams.set("type", "ws");
            uri.searchParams.set("host", APP_DOMAIN);

            for (const port of filterPort) {
              for (const protocol of filterVPN) {
                if (result.length >= filterLimit) break;

                uri.protocol = protocol;
                uri.port = port.toString();
                if (protocol == "ss") {
                  uri.username = btoa(`none:${uuid}`);
                  uri.searchParams.set(
                    "plugin",
                    `${atob(v2)}-plugin${port == 80 ? "" : ";tls"};mux=0;mode=websocket;path=/${prx.prxIP}-${
                      prx.prxPort
                    };host=${APP_DOMAIN}`,
                  );
                } else {
                  uri.username = uuid;
                }

                uri.searchParams.set("security", port == 443 ? "tls" : "none");
                uri.searchParams.set("sni", port == 80 && protocol == atob(flash) ? "" : APP_DOMAIN);
                uri.searchParams.set("path", `/${prx.prxIP}-${prx.prxPort}`);

                uri.hash = `${result.length + 1} ${getFlagEmoji(prx.country)} ${prx.org} WS ${
                  port == 443 ? "TLS" : "NTLS"
                } [${serviceName}]`;
                result.push(uri.toString());
              }
            }
          }

          let finalResult = "";
          switch (filterFormat) {
            case "raw":
              finalResult = result.join("\n");
              break;
            case atob(v2):
              finalResult = btoa(result.join("\n"));
              break;
            case atob(neko):
            case "sfa":
            case "bfr":
              const res = await fetch(CONVERTER_URL, {
                method: "POST",
                body: JSON.stringify({
                  url: result.join(","),
                  format: filterFormat,
                  template: "cf",
                }),
              });
              if (res.status == 200) {
                finalResult = await res.text();
              } else {
                return new Response(res.statusText, {
                  status: res.status,
                  headers: {
                    ...CORS_HEADER_OPTIONS,
                  },
                });
              }
              break;
          }

          return new Response(finalResult, {
            status: 200,
            headers: {
              ...CORS_HEADER_OPTIONS,
            },
          });
        } else if (apiPath.startsWith("/myip")) {
          return new Response(
            JSON.stringify({
              ip:
                request.headers.get("cf-connecting-ipv6") ||
                request.headers.get("cf-connecting-ip") ||
                request.headers.get("x-real-ip"),
              colo: request.headers.get("cf-ray")?.split("-")[1],
              ...request.cf,
            }),
            {
              headers: {
                ...CORS_HEADER_OPTIONS,
              },
            },
          );
        }
      }

      const targetReversePrx = env.REVERSE_PRX_TARGET || "example.com";
      return await reverseWeb(request, targetReversePrx);
    } catch (err) {
      return new Response(`An error occurred: ${err.toString()}`, {
        status: 500,
        headers: {
          ...CORS_HEADER_OPTIONS,
        },
      });
    }
  },
};

async function websocketHandler(request) {
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);

  webSocket.accept();

  let addressLog = "";
  let portLog = "";
  const log = (info, event) => {
    console.log(`[${addressLog}:${portLog}] ${info}`, event || "");
  };
  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";

  const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

  let remoteSocketWrapper = {
    value: null,
  };
  let isDNS = false;

  readableWebSocketStream
    .pipeTo(
      new WritableStream({
        async write(chunk, controller) {
          if (isDNS) {
            return handleUDPOutbound(
              DNS_SERVER_ADDRESS,
              DNS_SERVER_PORT,
              chunk,
              webSocket,
              null,
              log,
              RELAY_SERVER_UDP,
            );
          }
          if (remoteSocketWrapper.value) {
            const writer = remoteSocketWrapper.value.writable.getWriter();
            await writer.write(chunk);
            writer.releaseLock();
            return;
          }

          const protocol = await protocolSniffer(chunk);
          let protocolHeader;

          if (protocol === atob(horse)) {
            protocolHeader = readHorseHeader(chunk);
          } else if (protocol === atob(flash)) {
            protocolHeader = await readStreamHeader(chunk);
          } else if (protocol === atob(neko)) {
            protocolHeader = readNekoHeader(chunk);
          } else if (protocol === "ss") {
            protocolHeader = readSsHeader(chunk);
          } else {
            throw new Error("Unknown Protocol!");
          }

          addressLog = protocolHeader.addressRemote;
          portLog = `${protocolHeader.portRemote} -> ${protocolHeader.isUDP ? "UDP" : "TCP"}`;

          if (protocolHeader.hasError) {
            throw new Error(protocolHeader.message);
          }

          // Generate stream response header if needed
          let responseHeader = protocolHeader.version;
          if (protocol === atob(flash) && protocolHeader.needsResponse) {
            responseHeader = await generateStreamResponseHeader(
              protocolHeader.responseOptions,
              protocolHeader.encKey,
              protocolHeader.encIv,
            );
          }

          if (protocolHeader.isUDP) {
            if (protocolHeader.portRemote === 53) {
              isDNS = true;
              return handleUDPOutbound(
                DNS_SERVER_ADDRESS,
                DNS_SERVER_PORT,
                chunk,
                webSocket,
                responseHeader,
                log,
                RELAY_SERVER_UDP,
              );
            }

            return handleUDPOutbound(
              protocolHeader.addressRemote,
              protocolHeader.portRemote,
              chunk,
              webSocket,
              responseHeader,
              log,
              RELAY_SERVER_UDP,
            );
          }

          handleTCPOutBound(
            remoteSocketWrapper,
            protocolHeader.addressRemote,
            protocolHeader.portRemote,
            protocolHeader.rawClientData,
            webSocket,
            responseHeader,
            log,
          );
        },
        close() {
          log(`readableWebSocketStream is close`);
        },
        abort(reason) {
          log(`readableWebSocketStream is abort`, JSON.stringify(reason));
        },
      }),
    )
    .catch((err) => {
      log("readableWebSocketStream pipeTo error", err);
    });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

async function protocolSniffer(buffer) {
  if (buffer.byteLength >= 62) {
    const horseDelimiter = new Uint8Array(buffer.slice(56, 60));
    if (horseDelimiter[0] === 0x0d && horseDelimiter[1] === 0x0a) {
      if (horseDelimiter[2] === 0x01 || horseDelimiter[2] === 0x03 || horseDelimiter[2] === 0x7f) {
        if (horseDelimiter[3] === 0x01 || horseDelimiter[3] === 0x03 || horseDelimiter[3] === 0x04) {
          return atob(horse);
        }
      }
    }
  }

  // Light protocol detection (VLESS) - check UUID v4 pattern
  if (buffer.byteLength >= 18) {
    const version = new Uint8Array(buffer.slice(0, 1))[0];
    if (version === 0) {
      const protocolUuid = new Uint8Array(buffer.slice(1, 17));
      // Hanya mendukung UUID v4
      if (arrayBufferToHex(protocolUuid).match(/^[0-9a-f]{8}[0-9a-f]{4}4[0-9a-f]{3}[89ab][0-9a-f]{3}[0-9a-f]{12}$/i)) {
        return atob(neko);
      }
    }
  }

  // VMess AEAD detection: minimum 42 bytes (authId 16 + encLen 18 + nonce 8)
  // But we need to be more selective - check if it's NOT shadowsocks first
  if (buffer.byteLength >= 42) {
    // Shadowsocks ATYP is always 1, 3, or 4 at first byte
    const firstByte = new Uint8Array(buffer.slice(0, 1))[0];

    // If first byte looks like SS address type, it's probably SS
    if (firstByte === 0x01 || firstByte === 0x03 || firstByte === 0x04) {
      // Likely Shadowsocks, not VMess
      return "ss";
    }

    // Otherwise, assume it's VMess AEAD
    return atob(flash);
  }

  return "ss"; // default
}

async function generateStreamResponseHeader(responseOptions, encKey, encIv) {
  try {
    // Hash the key and IV from request header - NOTE: swapped compared to variable names!
    // In Rust: key = SHA256(key)[..16], iv = SHA256(iv)[..16]
    // Then use these for KDF base
    const key = (await sha256(encKey)).slice(0, 16);
    const iv = (await sha256(encIv)).slice(0, 16);

    // Encrypt length (2 bytes for value 4)
    const lengthKey = (await kdf(key, [SALT_B1])).slice(0, 16);
    const lengthIv = (await kdf(iv, [SALT_B2])).slice(0, 12);

    const lengthData = new Uint8Array(2);
    lengthData[0] = 0;
    lengthData[1] = 4;

    const encryptedLength = await aesGcmEncrypt(lengthKey, lengthIv, lengthData, new Uint8Array(0));

    // Create header payload (4 bytes)
    const headerPayload = new Uint8Array([
      responseOptions[0], // options[0] from request
      0x00,
      0x00,
      0x00, // padding
    ]);

    const payloadKey = (await kdf(key, [SALT_B3])).slice(0, 16);
    const payloadIv = (await kdf(iv, [SALT_B4])).slice(0, 12);

    const encryptedPayload = await aesGcmEncrypt(payloadKey, payloadIv, headerPayload, new Uint8Array(0));

    // Combine length + payload
    const response = new Uint8Array(encryptedLength.length + encryptedPayload.length);
    response.set(encryptedLength, 0);
    response.set(encryptedPayload, encryptedLength.length);

    return response;
  } catch (e) {
    console.error("Failed to generate stream response:", e);
    return new Uint8Array(0);
  }
}

async function handleTCPOutBound(
  remoteSocket,
  addressRemote,
  portRemote,
  rawClientData,
  webSocket,
  responseHeader,
  log,
) {
  async function connectAndWrite(address, port) {
    const tcpSocket = connect({
      hostname: address,
      port: port,
    });
    remoteSocket.value = tcpSocket;
    log(`connected to ${address}:${port}`);
    const writer = tcpSocket.writable.getWriter();
    await writer.write(rawClientData);
    writer.releaseLock();

    return tcpSocket;
  }

  async function retry() {
    const tcpSocket = await connectAndWrite(
      prxIP.split(/[:=-]/)[0] || addressRemote,
      prxIP.split(/[:=-]/)[1] || portRemote,
    );
    tcpSocket.closed
      .catch((error) => {
        console.log("retry tcpSocket closed error", error);
      })
      .finally(() => {
        safeCloseWebSocket(webSocket);
      });
    remoteSocketToWS(tcpSocket, webSocket, responseHeader, null, log);
  }

  const tcpSocket = await connectAndWrite(addressRemote, portRemote);

  remoteSocketToWS(tcpSocket, webSocket, responseHeader, retry, log);
}

async function handleUDPOutbound(targetAddress, targetPort, dataChunk, webSocket, responseHeader, log, relay) {
  try {
    let protocolHeader = responseHeader;

    const tcpSocket = connect({
      hostname: relay.host,
      port: relay.port,
    });

    const header = `udp:${targetAddress}:${targetPort}`;
    const headerBuffer = new TextEncoder().encode(header);
    const separator = new Uint8Array([0x7c]);
    const relayMessage = new Uint8Array(headerBuffer.length + separator.length + dataChunk.byteLength);
    relayMessage.set(headerBuffer, 0);
    relayMessage.set(separator, headerBuffer.length);
    relayMessage.set(new Uint8Array(dataChunk), headerBuffer.length + separator.length);

    const writer = tcpSocket.writable.getWriter();
    await writer.write(relayMessage);
    writer.releaseLock();

    await tcpSocket.readable.pipeTo(
      new WritableStream({
        async write(chunk) {
          if (webSocket.readyState === WS_READY_STATE_OPEN) {
            if (protocolHeader) {
              webSocket.send(await new Blob([protocolHeader, chunk]).arrayBuffer());
              protocolHeader = null;
            } else {
              webSocket.send(chunk);
            }
          }
        },
        close() {
          log(`UDP connection to ${targetAddress} closed`);
        },
        abort(reason) {
          console.error(`UDP connection aborted due to ${reason}`);
        },
      }),
    );
  } catch (e) {
    console.error(`Error while handling UDP outbound: ${e.message}`);
  }
}

function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
  let readableStreamCancel = false;
  const stream = new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener("message", (event) => {
        if (readableStreamCancel) {
          return;
        }
        const message = event.data;
        controller.enqueue(message);
      });
      webSocketServer.addEventListener("close", () => {
        safeCloseWebSocket(webSocketServer);
        if (readableStreamCancel) {
          return;
        }
        controller.close();
      });
      webSocketServer.addEventListener("error", (err) => {
        log("webSocketServer has error");
        controller.error(err);
      });
      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) {
        controller.error(error);
      } else if (earlyData) {
        controller.enqueue(earlyData);
      }
    },

    pull(controller) {},
    cancel(reason) {
      if (readableStreamCancel) {
        return;
      }
      log(`ReadableStream was canceled, due to ${reason}`);
      readableStreamCancel = true;
      safeCloseWebSocket(webSocketServer);
    },
  });

  return stream;
}

// Crypto Helper Functions
async function md5(...inputs) {
  const combined = new Uint8Array(inputs.reduce((acc, input) => acc + input.length, 0));
  let offset = 0;
  for (const input of inputs) {
    combined.set(new Uint8Array(input), offset);
    offset += input.length;
  }
  const hashBuffer = await crypto.subtle.digest("MD5", combined);
  return new Uint8Array(hashBuffer);
}

async function sha256(input) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", input);
  return new Uint8Array(hashBuffer);
}

async function kdf(key, path) {
  // VMess KDF uses custom recursive HMAC
  // Reference: https://github.com/v2ray/v2ray-core/blob/master/common/crypto/auth.go

  // Create HMAC-SHA256
  async function hmacSha256(key, data) {
    const hmacKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", hmacKey, data);
    return new Uint8Array(signature);
  }

  // RecursiveHash implementation matching Rust code
  async function recursiveHash(keyBytes, innerHashFn) {
    return async (data) => {
      // Prepare HMAC pads
      const ipad = new Uint8Array(64);
      const opad = new Uint8Array(64);

      // Copy key into pads
      ipad.set(keyBytes.slice(0, Math.min(64, keyBytes.length)));
      opad.set(keyBytes.slice(0, Math.min(64, keyBytes.length)));

      // XOR with HMAC constants
      for (let i = 0; i < 64; i++) {
        ipad[i] ^= 0x36;
        opad[i] ^= 0x5c;
      }

      // Compute inner hash: H(ipad || data)
      const innerData = new Uint8Array(ipad.length + data.length);
      innerData.set(ipad);
      innerData.set(data, ipad.length);
      const innerResult = await innerHashFn(innerData);

      // Compute outer hash: H(opad || innerResult)
      const outerData = new Uint8Array(opad.length + innerResult.length);
      outerData.set(opad);
      outerData.set(innerResult, opad.length);
      return await innerHashFn(outerData);
    };
  }

  // Base SHA256 hash function
  const sha256Hash = async (data) => {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  };

  // Build recursive hash chain
  let currentHashFn = await recursiveHash(new TextEncoder().encode("VMess AEAD KDF"), sha256Hash);

  for (const salt of path) {
    const saltBytes = typeof salt === "string" ? new TextEncoder().encode(salt) : new Uint8Array(salt);
    currentHashFn = await recursiveHash(saltBytes, currentHashFn);
  }

  // Final hash with key
  return await currentHashFn(key);
}

async function aesGcmDecrypt(key, nonce, data, aad) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["decrypt"]);

  try {
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, cryptoKey, data);
    return new Uint8Array(decrypted);
  } catch (e) {
    throw new Error("AEAD decryption failed: " + e.message);
  }
}

async function aesGcmEncrypt(key, nonce, data, aad) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt"]);

  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, cryptoKey, data);
  return new Uint8Array(encrypted);
}

// Stream Protocol Handler
async function readStreamHeader(buffer) {
  try {
    // For simplicity, we'll use a fixed UUID for decryption
    // In production, this should be configured
    const uuidString = "00000000-0000-0000-0000-000000000000";
    const uuidBytes = new Uint8Array(
      uuidString
        .replace(/-/g, "")
        .match(/.{1,2}/g)
        .map((byte) => parseInt(byte, 16)),
    );

    // Create MD5 hash of UUID + constant
    const authKey = await md5(
      uuidBytes,
      new TextEncoder().encode(atob("YzQ4NjE5ZmUtOGYwMi00OWUwLWI5ZTktZWRmNzYzZTE3ZTIx")),
    );

    // Read AEAD header structure
    const authId = new Uint8Array(buffer.slice(0, 16));
    const encryptedLength = new Uint8Array(buffer.slice(16, 34));
    const nonce = new Uint8Array(buffer.slice(34, 42));

    // Derive keys for length decryption
    const lengthKey = (await kdf(authKey, [SALT_A1, authId, nonce])).slice(0, 16);

    const lengthIv = (await kdf(authKey, [SALT_A2, authId, nonce])).slice(0, 12);

    // Decrypt header length (AAD is authId)
    const lengthBytes = await aesGcmDecrypt(lengthKey, lengthIv, encryptedLength, authId);
    const headerLength = (lengthBytes[0] << 8) | lengthBytes[1];

    // Read encrypted header payload (with 16 bytes GCM tag)
    const encryptedHeader = new Uint8Array(buffer.slice(42, 42 + headerLength + 16));

    // Derive keys for payload decryption
    const payloadKey = (await kdf(authKey, [SALT_A3, authId, nonce])).slice(0, 16);

    const payloadIv = (await kdf(authKey, [SALT_A4, authId, nonce])).slice(0, 12);

    // Decrypt header payload (AAD is authId)
    const headerPayload = await aesGcmDecrypt(payloadKey, payloadIv, encryptedHeader, authId);

    // Debug logging
    console.log("Header payload length:", headerPayload.length);
    console.log("Header payload (hex):", arrayBufferToHex(headerPayload.buffer));

    // Parse decrypted header - following exact Rust implementation order
    const view = new DataView(headerPayload.buffer);
    let offset = 0;

    // Version (1 byte)
    const version = view.getUint8(offset);
    offset += 1;
    console.log("[0] Version:", version, "| offset now:", offset);
    if (version !== 1) {
      return { hasError: true, message: `Invalid protocol version: ${version}` };
    }

    // IV (16 bytes)
    const encIv = new Uint8Array(headerPayload.slice(offset, offset + 16));
    offset += 16;
    console.log("[1-16] IV read | offset now:", offset);

    // Key (16 bytes)
    const encKey = new Uint8Array(headerPayload.slice(offset, offset + 16));
    offset += 16;
    console.log("[17-32] Key read | offset now:", offset);

    // Options (4 bytes total - Rust reads as array)
    const options = new Uint8Array(headerPayload.slice(offset, offset + 4));
    offset += 4;
    console.log("[33-36] Options:", Array.from(options), "| offset now:", offset);

    // Command (1 byte)
    const cmd = view.getUint8(offset);
    offset += 1;
    console.log("[37] Command:", cmd, "| offset now:", offset);
    const isUDP = cmd !== 0x01;

    // Port (2 bytes, big-endian)
    const portRemote = view.getUint16(offset, false);
    offset += 2;
    console.log("[38-39] Port:", portRemote, "| offset now:", offset);

    // Address Type (1 byte)
    const addressType = view.getUint8(offset);
    offset += 1;
    console.log("[40] Address type:", addressType, "| offset now:", offset);
    let addressRemote = "";

    // Parse address following Rust implementation
    switch (addressType) {
      case 1: // IPv4
        addressRemote = `${view.getUint8(offset)}.${view.getUint8(offset + 1)}.${view.getUint8(offset + 2)}.${view.getUint8(offset + 3)}`;
        offset += 4;
        break;
      case 2: // Domain (same as case 3 in Rust)
      case 3: // Domain
        const domainLength = view.getUint8(offset);
        offset += 1;
        addressRemote = new TextDecoder().decode(headerPayload.slice(offset, offset + domainLength));
        offset += domainLength;
        break;
      case 4: // IPv6
        const ipv6Parts = [];
        for (let i = 0; i < 8; i++) {
          ipv6Parts.push(view.getUint16(offset + i * 2, false).toString(16));
        }
        addressRemote = ipv6Parts.join(":");
        offset += 16;
        break;
      default:
        console.log("ERROR: Invalid address type:", addressType, "at offset:", offset - 1);
        return { hasError: true, message: `Invalid address type: ${addressType} (hex: 0x${addressType.toString(16)})` };
    }

    console.log("Final parsed address:", addressRemote);

    // Calculate raw data index: authId (16) + encryptedLength (18) + nonce (8) + encrypted header payload (headerLength + 16 GCM tag)
    const rawDataIndex = 42 + headerLength + 16;

    return {
      hasError: false,
      addressRemote,
      addressType,
      portRemote,
      rawDataIndex,
      rawClientData: buffer.slice(rawDataIndex),
      version: new Uint8Array([options[0], 0]),
      isUDP,
      needsResponse: true,
      responseOptions: options,
      encKey: encKey,
      encIv: encIv,
    };
  } catch (e) {
    return {
      hasError: true,
      message: "Stream header parsing failed: " + e.message,
    };
  }
}

function readSsHeader(ssBuffer) {
  const view = new DataView(ssBuffer);

  const addressType = view.getUint8(0);
  let addressLength = 0;
  let addressValueIndex = 1;
  let addressValue = "";

  switch (addressType) {
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 3:
      addressLength = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 4:
      addressLength = 16;
      const dataView = new DataView(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `Invalid addressType for SS: ${addressType}`,
      };
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `Destination address empty, address type is: ${addressType}`,
    };
  }

  const portIndex = addressValueIndex + addressLength;
  const portBuffer = ssBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);
  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: portIndex + 2,
    rawClientData: ssBuffer.slice(portIndex + 2),
    version: null,
    isUDP: portRemote == 53,
  };
}

function readNekoHeader(buffer) {
  const version = new Uint8Array(buffer.slice(0, 1));
  let isUDP = false;

  const optLength = new Uint8Array(buffer.slice(17, 18))[0];

  const cmd = new Uint8Array(buffer.slice(18 + optLength, 18 + optLength + 1))[0];
  if (cmd === 1) {
  } else if (cmd === 2) {
    isUDP = true;
  } else {
    return {
      hasError: true,
      message: `command ${cmd} is not supported`,
    };
  }
  const portIndex = 18 + optLength + 1;
  const portBuffer = buffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);

  let addressIndex = portIndex + 2;
  const addressBuffer = new Uint8Array(buffer.slice(addressIndex, addressIndex + 1));

  const addressType = addressBuffer[0];
  let addressLength = 0;
  let addressValueIndex = addressIndex + 1;
  let addressValue = "";
  switch (addressType) {
    case 1: // For IPv4
      addressLength = 4;
      addressValue = new Uint8Array(buffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 2: // For Domain
      addressLength = new Uint8Array(buffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(buffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 3: // For IPv6
      addressLength = 16;
      const dataView = new DataView(buffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `invild  addressType is ${addressType}`,
      };
  }
  if (!addressValue) {
    return {
      hasError: true,
      message: `addressValue is empty, addressType is ${addressType}`,
    };
  }

  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: addressValueIndex + addressLength,
    rawClientData: buffer.slice(addressValueIndex + addressLength),
    version: new Uint8Array([version[0], 0]),
    isUDP: isUDP,
  };
}

function readHorseHeader(buffer) {
  const dataBuffer = buffer.slice(58);
  if (dataBuffer.byteLength < 6) {
    return {
      hasError: true,
      message: "invalid request data",
    };
  }

  let isUDP = false;
  const view = new DataView(dataBuffer);
  const cmd = view.getUint8(0);
  if (cmd == 3) {
    isUDP = true;
  } else if (cmd != 1) {
    throw new Error("Unsupported command type!");
  }

  let addressType = view.getUint8(1);
  let addressLength = 0;
  let addressValueIndex = 2;
  let addressValue = "";
  switch (addressType) {
    case 1: // For IPv4
      addressLength = 4;
      addressValue = new Uint8Array(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 3: // For Domain
      addressLength = new Uint8Array(dataBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 4: // For IPv6
      addressLength = 16;
      const dataView = new DataView(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `invalid addressType is ${addressType}`,
      };
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `address is empty, addressType is ${addressType}`,
    };
  }

  const portIndex = addressValueIndex + addressLength;
  const portBuffer = dataBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);
  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: portIndex + 4,
    rawClientData: dataBuffer.slice(portIndex + 4),
    version: null,
    isUDP: isUDP,
  };
}

async function remoteSocketToWS(remoteSocket, webSocket, responseHeader, retry, log) {
  let header = responseHeader;
  let hasIncomingData = false;
  await remoteSocket.readable
    .pipeTo(
      new WritableStream({
        start() {},
        async write(chunk, controller) {
          hasIncomingData = true;
          if (webSocket.readyState !== WS_READY_STATE_OPEN) {
            controller.error("webSocket.readyState is not open, maybe close");
          }
          if (header) {
            webSocket.send(await new Blob([header, chunk]).arrayBuffer());
            header = null;
          } else {
            webSocket.send(chunk);
          }
        },
        close() {
          log(`remoteConnection!.readable is close with hasIncomingData is ${hasIncomingData}`);
        },
        abort(reason) {
          console.error(`remoteConnection!.readable abort`, reason);
        },
      }),
    )
    .catch((error) => {
      console.error(`remoteSocketToWS has exception `, error.stack || error);
      safeCloseWebSocket(webSocket);
    });
  if (hasIncomingData === false && retry) {
    log(`retry`);
    retry();
  }
}

function safeCloseWebSocket(socket) {
  try {
    if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
      socket.close();
    }
  } catch (error) {
    console.error("safeCloseWebSocket error", error);
  }
}

async function handleSubPage(request, url, env) {
  // Render halaman sub sendiri — UI kartu grid (anti loop redirect)
  const pageIndex = parseInt(url.pathname.match(/^\/sub\/(\d+)$/)?.[1] || "0");
  const countrySelect = url.searchParams.get("cc")?.split(",");
  const prxBankUrl = url.searchParams.get("prx-list") || env.PRX_BANK_URL;
  let prxList = (await getPrxList(prxBankUrl)).filter((prx) =>
    countrySelect ? countrySelect.includes(prx.country) : true
  );
  const pageSize = 24;
  const totalPages = Math.max(1, Math.ceil(prxList.length / pageSize));
  const page = Math.min(pageIndex, totalPages - 1);
  const slice = prxList.slice(page * pageSize, page * pageSize + pageSize);

  // == Filter bendera negara (top bar) ==
  const countries = [...new Set(prxList.map((p) => p.country))].sort();
  let flags = `<a href="/sub" class="flag-chip ${countrySelect ? "" : "active"}" title="Semua negara">🌐</a>`;
  for (const c of countries) {
    const act = countrySelect?.includes(c) ? "active" : "";
    flags += `<a href="/sub?cc=${c}" class="flag-chip ${act}" title="${c}">${getFlagEmoji(c)} <span class="cc">${c}</span></a>`;
  }

  // == Panel wildcard domain (jika env CF API diset) ==
  const apiReady = !!(env.CF_API_TOKEN && env.CF_ACCOUNT_ID && env.CF_ZONE_ID);
  let domainUI = "";
  if (apiReady) {
    const rootDom = env.CF_ROOT_DOMAIN || APP_DOMAIN.split(".").slice(1).join(".");
    domainUI = `<details class="mt-6 bg-neutral-800/70 border border-neutral-700 rounded-xl p-4">
<summary class="cursor-pointer text-sm font-semibold text-amber-400">＋ Daftarkan wildcard domain (${APP_DOMAIN})</summary>
<div class="mt-3 flex gap-2">
<form action="/api/v1/domains/put" method="get" class="flex gap-2 flex-1">
<input name="domain" placeholder="nama.${rootDom}" class="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400"/>
<button class="bg-amber-400 hover:bg-amber-300 text-black px-4 py-2 rounded-lg text-sm font-semibold transition">Daftar</button>
</form>
<a href="/api/v1/domains/get" class="bg-neutral-700 hover:bg-neutral-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition whitespace-nowrap">List Domain</a>
</div></details>`;
  }

  // == Kartu proxy ==
  let cards = "";
  for (const prx of slice) {
    const uuid = crypto.randomUUID();
    // Vless (default)
    const uriVless = new URL(`vless://${uuid}@${APP_DOMAIN}:443`);
    uriVless.searchParams.set("encryption", "none");
    uriVless.searchParams.set("type", "ws");
    uriVless.searchParams.set("host", APP_DOMAIN);
    uriVless.searchParams.set("path", `/${prx.prxIP}-${prx.prxPort}`);
    uriVless.searchParams.set("security", "tls");
    uriVless.searchParams.set("sni", APP_DOMAIN);
    uriVless.hash = `${getFlagEmoji(prx.country)} ${prx.org} WS TLS [${serviceName}]`;
    // Trojan
    const uriTrojan = new URL(`trojan://${uuid}@${APP_DOMAIN}:443`);
    uriTrojan.searchParams.set("type", "ws");
    uriTrojan.searchParams.set("host", APP_DOMAIN);
    uriTrojan.searchParams.set("path", `/${prx.prxIP}-${prx.prxPort}`);
    uriTrojan.searchParams.set("security", "tls");
    uriTrojan.searchParams.set("sni", APP_DOMAIN);
    uriTrojan.hash = `${getFlagEmoji(prx.country)} ${prx.org} Trojan WS TLS [${serviceName}]`;

    cards += `<div class="proxy-card">
<div class="card-top">
  <div class="flag-big" title="${prx.country}">${getFlagEmoji(prx.country)}</div>
  <div class="flex-1 min-w-0">
    <div class="font-semibold truncate">${prx.org}</div>
    <div class="text-xs text-neutral-400 mono">${prx.prxIP}:${prx.prxPort} · ${prx.country}</div>
  </div>
  <span class="badge">WS TLS</span>
</div>
<div class="card-actions">
  <button class="btn-copy btn-vless" onclick="copyCfg('${uriVless.toString().replace(/'/g, "\\'")}')">VLESS</button>
  <button class="btn-copy btn-trojan" onclick="copyCfg('${uriTrojan.toString().replace(/'/g, "\\'")}')">TROJAN</button>
</div>
</div>`;
  }

  // == Pagination ==
  let pag = "";
  for (let i = 0; i < totalPages; i++) {
    const act = i === page ? "active" : "";
    pag += `<a href="/sub/${i}?${url.searchParams.toString()}" class="page-btn ${act}">${i + 1}</a>`;
  }

  const html = `<!DOCTYPE html><html lang="id"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${serviceName} · ${APP_DOMAIN}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;color:#e5e7eb;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;min-height:100vh}
.wrap{max-width:1200px;margin:0 auto;padding:24px 16px 60px}
header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px}
.logo{font-size:22px;font-weight:800;letter-spacing:-0.5px}
.logo span{color:#f59e0b}
.logo small{font-size:12px;color:#6b7280;font-weight:500;margin-left:8px}
.stats{display:flex;gap:16px;font-size:13px;color:#9ca3af}
.stats b{color:#f59e0b;font-weight:700}
.flags-bar{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:24px}
.flag-chip{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;background:#17171f;border:1px solid #2a2a35;border-radius:999px;font-size:13px;text-decoration:none;color:#d1d5db;transition:all .15s}
.flag-chip:hover{border-color:#f59e0b}
.flag-chip.active{background:#f59e0b;border-color:#f59e0b;color:#09090b;font-weight:700}
.flag-chip .cc{font-size:10px;opacity:.7}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px}
.proxy-card{background:#13131b;border:1px solid #23232e;border-radius:14px;padding:16px;transition:all .2s;display:flex;flex-direction:column;gap:12px}
.proxy-card:hover{border-color:#3a3a4a;transform:translateY(-2px);box-shadow:0 8px 24px rgba(245,158,11,.06)}
.card-top{display:flex;align-items:center;gap:10px}
.flag-big{font-size:28px;line-height:1}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.badge{background:#1c1c26;color:#f59e0b;border:1px solid #33333f;font-size:10px;font-weight:700;padding:3px 8px;border-radius:999px;white-space:nowrap}
.card-actions{display:flex;gap:8px}
.btn-copy{flex:1;padding:9px 0;border:none;border-radius:9px;font-size:12px;font-weight:700;letter-spacing:.4px;cursor:pointer;transition:all .15s;color:#fff}
.btn-vless{background:#2563eb}
.btn-vless:hover{background:#1d4ed8}
.btn-trojan{background:#7c3aed}
.btn-trojan:hover{background:#6d28d9}
.pagination{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:28px}
.page-btn{min-width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;padding:0 10px;background:#17171f;border:1px solid #2a2a35;border-radius:8px;color:#d1d5db;text-decoration:none;font-size:13px;transition:all .15s}
.page-btn:hover{border-color:#f59e0b;color:#f59e0b}
.page-btn.active{background:#f59e0b;border-color:#f59e0b;color:#09090b;font-weight:700}
.api-box{margin-top:20px;background:#0e0e14;border:1px dashed #2a2a35;border-radius:12px;padding:14px;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#9ca3af;line-height:1.8;overflow-x:auto}
.api-box code{color:#f59e0b}
footer{margin-top:36px;text-align:center;font-size:11px;color:#4b5563}
.notif{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);background:#f59e0b;color:#09090b;font-weight:700;font-size:13px;padding:10px 22px;border-radius:999px;opacity:0;transition:all .3s;z-index:99;pointer-events:none}
.notif.show{opacity:1;transform:translateX(-50%) translateY(0)}
</style></head>
<body>
<div class="wrap">
<header>
  <div class="logo">NAUTICA <span>·</span> ${serviceName.toUpperCase()}<small>${APP_DOMAIN}</small></div>
  <div class="stats">
    <span>Proxy <b>${prxList.length}</b></span>
    <span>Page <b>${page + 1}/${totalPages}</b></span>
    <span>Colo <b>SIN</b></span>
  </div>
</header>
<div class="flags-bar">${flags}</div>
<div class="grid">${cards}</div>
<div class="pagination">${pag}</div>
${domainUI}
<div class="api-box">API SUB · <code>/api/v1/sub?limit=10&amp;cc=ID,SG&amp;format=raw</code> · format: raw | v2ray | clash | sfa | bfr<br/>HEALTH · <code>/check?target=IP:PORT</code> · MYIP · <code>/api/v1/myip</code></div>
<footer>Powered by <b>Nautica</b> (FoolVPN) · fork <b>burnicehomenick</b> · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</footer>
</div>
<div class="notif" id="notif">✓ Config disalin</div>
<script>
function copyCfg(cfg){
  navigator.clipboard.writeText(cfg).then(function(){
    var n=document.getElementById('notif');
    n.classList.add('show');
    setTimeout(function(){n.classList.remove('show')},1600);
  }).catch(function(){
    var t=document.createElement('textarea');t.value=cfg;document.body.appendChild(t);t.select();
    document.execCommand('copy');document.body.removeChild(t);
    var n=document.getElementById('notif');n.classList.add('show');
    setTimeout(function(){n.classList.remove('show')},1600);
  });
}
</script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html;charset=utf-8", ...CORS_HEADER_OPTIONS },
  });
}

async function checkPrxHealth(prxIP, prxPort) {
  // Self-contained health check: TCP connect langsung dari worker.
  // Gak butuh API eksternal (bebas dari dependency FoolVPN).
  const timeoutMs = 3000;
  try {
    const socket = connect({ hostname: prxIP, port: parseInt(prxPort) || 443 });
    const result = await Promise.race([
      new Promise((resolve) => {
        socket.opened.then(() => resolve({ proxyip: true, delay: 0, method: "tcp" }))
          .catch(() => resolve({ proxyip: false }));
      }),
      new Promise((resolve) => setTimeout(() => {
        try { socket.close(); } catch (e) {}
        resolve({ proxyip: false, timeout: true });
      }, timeoutMs)),
    ]);
    return result;
  } catch (e) {
    return { proxyip: false, error: String(e) };
  }
}

// Cloudflare Workers API (wildcard domain registration) — pakai env var, bukan hardcode key
class CloudflareApi {
  constructor(env) {
    this.token = env.CF_API_TOKEN;
    this.accountID = env.CF_ACCOUNT_ID;
    this.zoneID = env.CF_ZONE_ID;
    this.rootDomain = env.CF_ROOT_DOMAIN || (APP_DOMAIN.split(".").slice(1).join("."));
    this.headers = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }
  async getDomainList() {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountID}/workers/domains`;
    const res = await fetch(url, { headers: this.headers });
    if (res.status == 200) {
      const respJson = await res.json();
      return respJson.result
        .filter((data) => data.service == serviceName)
        .map((data) => data.hostname);
    }
    return [];
  }
  async registerDomain(domain2) {
    if (!domain2) return 400;
    domain2 = domain2.toLowerCase();
    if (!domain2.endsWith(this.rootDomain)) return 400;
    const registered = await this.getDomainList();
    if (registered.includes(domain2)) return 409;
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountID}/workers/domains`;
    const res = await fetch(url, {
      method: "PUT",
      body: JSON.stringify({
        environment: "production",
        hostname: domain2,
        service: serviceName,
        zone_id: this.zoneID,
      }),
      headers: this.headers,
    });
    return res.status;
  }
}

// Helpers
function base64ToArrayBuffer(base64Str) {
  if (!base64Str) {
    return { error: null };
  }
  try {
    base64Str = base64Str.replace(/-/g, "+").replace(/_/g, "/");
    const decode = atob(base64Str);
    const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
    return { earlyData: arryBuffer.buffer, error: null };
  } catch (error) {
    return { error };
  }
}

function arrayBufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function shuffleArray(array) {
  let currentIndex = array.length;

  // While there remain elements to shuffle...
  while (currentIndex != 0) {
    // Pick a remaining element...
    let randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
}

function reverse(s) {
  return s.split("").reverse().join("");
}

function getFlagEmoji(isoCode) {
  const codePoints = isoCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}
