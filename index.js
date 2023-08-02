var fs = require("fs");
var http = require("http");
var https = require("https");

var proxyConfig = {};
if (fs.existsSync(__dirname + "/../../../reverse-proxy-config.json")) proxyConfig = JSON.parse(fs.readFileSync(__dirname + "/../../../reverse-proxy-config.json").toString());
else fs.writeFileSync(__dirname + "/../../../reverse-proxy-config.json", "{}");

function Mod() {}
Mod.prototype.callback = function callback(req, res, serverconsole, responseEnd, href, ext, uobject, search, defaultpage, users, page404, head, foot, fd, elseCallback, configJSON, callServerError, getCustomHeaders, origHref, redirect, parsePostData) {
  return function() {
    var hostnames = Object.keys(proxyConfig);
    var matchingHostname = null;
    for (var i = 0; i < hostnames.length; i++) {
      if (hostnames[i] == "*") {
        matchingHostname = "*";
        break;
      } else if (req.headers.host && hostnames[i].indexOf("*.") == 0 && hostnames[i] != "*.") {
        var hostnamesRoot = hostnames[i].substr(2);
        if (req.headers.host == hostnamesRoot || req.headers.host.indexOf("." + hostnamesRoot) == req.headers.host.length - hostnamesRoot.length - 1) {
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
        callServerError(500, "reverse-proxy-mod/1.0.2", new Error("Proxy server is misconfigured. Hostname property is missing."));
        return;
      }
      try {
        var x = res.getHeaderNames();
        for (var i = 0; i < x.length; i++) {
          res.removeHeader(x[i]);
        }
      } catch (ex) {}
      var hdrs = JSON.parse(JSON.stringify(req.headers));
      hdrs["x-forwarded-for"] = req.socket.remoteAddress;
      hdrs["x-forwarded-proto"] = req.socket.encrypted ? "https" : "http";
      hdrs["x-svr-js-client"] = req.socket.remoteAddress + ":" + req.socket.remotePort;
      delete hdrs[":method"];
      delete hdrs[":scheme"];
      delete hdrs[":authority"];
      delete hdrs[":path"];
      delete hdrs["keep-alive"];
      hdrs["connection"] = "close";
      var options = {
        hostname: (secureHostname && req.socket.encrypted) ? secureHostname : hostname,
        port: (secureHostname && req.socket.encrypted) ? securePort : port,
        path: req.url,
        method: req.method,
        headers: hdrs,
        joinDuplicateHeaders: true,
        rejectUnauthorized: false
      };
      var proxy = ((secureHostname && req.socket.encrypted) ? https : http).request(options, function(sres) {
        serverconsole.resmessage("Connected to back-end!");
        delete sres.headers["connection"];
        delete sres.headers["Connection"];
        delete sres.headers["transfer-encoding"];
        delete sres.headers["Transfer-Encoding"];
        delete sres.headers["keep-alive"];
        delete sres.headers["Keep-Alive"];
        res.writeHead(sres.statusCode, sres.headers);
        sres.pipe(res, {
          end: true
        });
      });
      proxy.on("error", (ex) => {
        try {
          if (ex.code == "ETIMEDOUT") {
            callServerError(504, "reverse-proxy-mod/1.0.2", ex); //Server error
          } else {
            callServerError(502, "reverse-proxy-mod/1.0.2", ex); //Server error
          }
        } catch (ex) {}
        serverconsole.errmessage("Client fails to recieve content."); //Log into SVR.JS
      });
      req.pipe(proxy, {
        end: true
      });
    } else {
      elseCallback();
    }
  }
}

module.exports = Mod;
