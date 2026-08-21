// Minimal fixture server for the smoke test (CommonJS, Windows-safe paths).
//
// Serves fixtures under sshxl-like paths so pageKind() in the userscript
// classifies them correctly:
//   /nl/aanbod                      -> overview.html
//   /nl/aanbod/<id>-<anything>      -> room.html          (live apply flow)
//   /nl/aanbod/<applied-id>-<...>   -> room-applied.html  (already applied)
//   /nl/aanbod/<refused-id>-<...>   -> room-refused.html  (site refuses modal)
const http = require("http");

const PORT = 8791;
const APPLIED_ID = "9999002";
const REFUSED_ID = "9999004";
const DETAIL_ID = "9999005";

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  let file = null;

  if (path === "/nl/aanbod" || path === "/nl/aanbod/") {
    file = "overview.html";
  } else if (/^\/nl\/aanbod\/\d+/.test(path)) {
    const id = path.match(/^\/nl\/aanbod\/(\d+)/)[1];
    file =
      id === APPLIED_ID
        ? "room-applied.html"
        : id === REFUSED_ID
          ? "room-refused.html"
          : id === DETAIL_ID
            ? "../../sshxl.nl/nl/aanbod/1477290-cambridgelaan-787-k3.html"
            : "room.html";
  } else if (path === "/nl/mijn-ssh/reacties" || path === "/nl/mijn-ssh/reacties/") {
    file = "../../sshxl.nl/nl/mijn-ssh/reacties.html";
  } else if (path === "/nl/mijn-ssh/mijn-profiel" || path === "/nl/mijn-ssh/mijn-profiel/") {
    file = "../../sshxl.nl/nl/mijn-ssh/mijn-profiel.html";
  } else if (path === "/healthz") {
    res.writeHead(200);
    res.end("ok");
    return;
  }

  if (!file) {
    res.writeHead(404);
    res.end(`no fixture for ${path}`);
    return;
  }

  try {
    const data = require("fs").readFileSync(require("path").join(__dirname, file));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(data);
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(`fixture server up on http://127.0.0.1:${PORT}/nl/aanbod`),
);
