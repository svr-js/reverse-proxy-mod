var fs = require("fs");
var os = require("os");
var http = require("http");
var https = require("https");
var net = require("net");
var tls = require("tls");

var proxyConfig = {};
if (fs.existsSync(__dirname + "/../../../reverse-proxy-config.json")) proxyConfig = JSON.parse(fs.readFileSync(__dirname + "/../../../reverse-proxy-config.json").toString());
else fs.writeFileSync(__dirname + "/../../../reverse-proxy-config.json", "{}");

function Mod() {}
Mod.prototype.callback = function callback(req, res, serverconsole, responseEnd, href, ext, uobject, search, defaultpage, users, page404, head, foot, fd, elseCallback, configJSON, callServerError, getCustomHeaders, origHref, redirect, parsePostData) {
  return function () {
    var hostnames = Object.keys(proxyConfig);
    var isPath = false;
    var matchingHostname = null;
    for (var i = 0; i < hostnames.length; i++) {
      if (hostnames[i] == "*") {
        matchingHostname = "*";
        break;
      } else if (hostnames[i][0] == "/" && (href == hostnames[i] || href.indexOf(hostnames[i] + "/") == 0)) {
        matchingHostname = hostnames[i];
        isPath = true;
        break;
      } else if (req.headers.host && hostnames[i].indexOf("*.") == 0 && hostnames[i] != "*.") {
        var hostnamesRoot = hostnames[i].substr(2);
        if (req.headers.host == hostnamesRoot || (req.headers.host.length > hostnamesRoot.length && req.headers.host.indexOf("." + hostnamesRoot) == req.headers.host.length - hostnamesRoot.length - 1)) {
          matchingHostname = hostnames[i];
          break;
        }
      } else if (req.headers.host && req.headers.host == hostnames[i]) {
        matchingHostname = hostnames[i];
        break;
      }
    }
    if (matchingHostname) {
      var hostname = proxyConfig[matchingHostname].hostname;
      var port = proxyConfig[matchingHostname].port;
      var secureHostname = proxyConfig[matchingHostname].secureHostname;
      var securePort = proxyConfig[matchingHostname].securePort;
      if (!port) port = 80;
      if (!securePort && secureHostname) securePort = 443;
      if (!hostname) {
        callServerError(500, "reverse-proxy-mod/1.1.4", new Error("Proxy server is misconfigured. Hostname property is missing."));
        return;
      }
      try {
        var x = res.getHeaderNames();
        for (var i = 0; i < x.length; i++) {
          res.removeHeader(x[i]);
        }
      } catch (ex) {}
      var preparedPath = req.url;
      if(isPath) {
        if(preparedPath == matchingHostname) {
          preparedPath = "/";
        } else {
          preparedPath = preparedPath.replace(matchingHostname.substring(1) + "/","");
          if(preparedPath == "") preparedPath = "/";
        }
      }
      var hdrs = JSON.parse(JSON.stringify(req.headers));
      hdrs["x-forwarded-for"] = req.socket.remoteAddress;
      hdrs["x-forwarded-proto"] = req.socket.encrypted ? "https" : "http";
      hdrs["x-svr-js-client"] = req.socket.remoteAddress + ":" + req.socket.remotePort;
      delete hdrs[":method"];
      delete hdrs[":scheme"];
      delete hdrs[":authority"];
      delete hdrs[":path"];
      delete hdrs["keep-alive"];
      if ((req.httpVersion == "1.1" || req.httpVersion == "1.0") && String(hdrs["connection"]).toLowerCase() == "upgrade") {
        var socket = ((secureHostname && req.socket.encrypted) ? tls : net).createConnection({
          host: (secureHostname && req.socket.encrypted) ? secureHostname : hostname,
          port: (secureHostname && req.socket.encrypted) ? securePort : port,
          joinDuplicateHeaders: true,
          rejectUnauthorized: false
        }, function () {
          serverconsole.resmessage("Connected to back-end!");
          socket.pipe(res.socket);
          socket.write(req.method + " " + preparedPath + " HTTP/1.1\r\n");
          Object.keys(hdrs).forEach(function (headerName) {
            var header = hdrs[headerName];
            if (typeof header === "object") {
              header.forEach(function (value) {
                socket.write(headerName + ": " + value + "\r\n");
              });
            } else {
              socket.write(headerName + ": " + header + "\r\n");
            }
          });
          socket.write("\r\n");
          req.socket.pipe(socket);
        }).on("error", (ex) => {
          try {
            if (ex.code == "ENOTFOUND" || ex.code == "EHOSTUNREACH" || ex.code == "ECONNREFUSED") {
              callServerError(503, "reverse-proxy-mod/1.1.4", ex); //Server error
            } else if (ex.code == "ETIMEDOUT") {
              callServerError(504, "reverse-proxy-mod/1.1.4", ex); //Server error
            } else {
              callServerError(502, "reverse-proxy-mod/1.1.4", ex); //Server error
            }
          } catch (ex) {}
          serverconsole.errmessage("Client fails to recieve content."); //Log into SVR.JS
        });
      } else {
        if (String(hdrs["connection"]).toLowerCase() != "upgrade") hdrs["connection"] = "close";
        var options = {
          hostname: (secureHostname && req.socket.encrypted) ? secureHostname : hostname,
          port: (secureHostname && req.socket.encrypted) ? securePort : port,
          path: preparedPath,
          method: req.method,
          headers: hdrs,
          joinDuplicateHeaders: true,
          rejectUnauthorized: false
        };
        var proxy = ((secureHostname && req.socket.encrypted) ? https : http).request(options, function (sres) {
          serverconsole.resmessage("Connected to back-end!");
          if (String(hdrs["connection"]).toLowerCase() != "upgrade") {
            delete sres.headers["connection"];
            delete sres.headers["Connection"];
          }
          delete sres.headers["transfer-encoding"];
          delete sres.headers["Transfer-Encoding"];
          delete sres.headers["keep-alive"];
          delete sres.headers["Keep-Alive"];
          try {
            res.writeHead(sres.statusCode, sres.headers);
            sres.pipe(res);
            res.prependListener("end", function () {
              try {
                sres.end();
              } catch (ex) {}
            });
          } catch (ex) {
            callServerError(502, "reverse-proxy-mod/1.1.4", ex); //Server error
          }
        });
        proxy.on("error", function (ex) {
          try {
            if (ex.code == "ENOTFOUND" || ex.code == "EHOSTUNREACH" || ex.code == "ECONNREFUSED") {
              callServerError(503, "reverse-proxy-mod/1.1.4", ex); //Server error
            } else if (ex.code == "ETIMEDOUT") {
              callServerError(504, "reverse-proxy-mod/1.1.4", ex); //Server error
            } else {
              callServerError(502, "reverse-proxy-mod/1.1.4", ex); //Server error
            }
          } catch (ex) {}
          serverconsole.errmessage("Client fails to recieve content."); //Log into SVR.JS
        });
        req.pipe(proxy);
        req.prependListener("end", function () {
          try {
            proxy.end();
          } catch (ex) {}
        });
      }
    } else if ((href == "/reverse-proxy-config.json" || (os.platform() == "win32" && href.toLowerCase() == "/reverse-proxy-config.json")) && path.normalize(__dirname + "/../../..") == process.cwd()) {
      callServerError(403, "reverse-proxy-mod/1.1.4");
    } else {
      elseCallback();
    }
  }
}

module.exports = Mod;
