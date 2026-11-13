// Host side of the Caissa WebAssembly build (prepended to the Emscripten output).
//
// Web Worker: the page first posts { net: Blob | ArrayBuffer } with the neural
// network, then UCI lines as strings; engine output comes back as strings.
// Node (tests): UCI lines on stdin, output on stdout, the network is read from
// the file next to this script.
//
// UCI lines are run one after the other. A search suspends itself every few
// milliseconds (see wasm_main.cpp), so "stop" and "isready" are answered while
// it runs; every other line waits until the search has printed its bestmove.
var Module = typeof Module !== "undefined" ? Module : {};

(function () {
  var NET_FILE = "caissa.pnn";
  var isNode = typeof process === "object" && !!process.versions && !!process.versions.node && typeof importScripts !== "function";

  var queue = [];
  var ready = false; // runtime initialised and network loaded
  var busy = false; // a line is being executed
  var searching = false; // ... and it is a search
  var runtimeUp = false;
  var net = null; // Blob | ArrayBuffer | Uint8Array, until copied into the engine
  var stopFlag = 0;

  var emit = isNode
    ? function (line) {
        process.stdout.write(line + "\n");
      }
    : function (line) {
        postMessage(line);
      };

  // Errors inside promise callbacks would vanish; rethrow them as uncaught, so the
  // page's worker.onerror (or Node's exit code) sees that the engine is gone.
  function fatal(err) {
    setTimeout(function () {
      throw err instanceof Error ? err : new Error(String(err));
    }, 0);
  }

  Module["print"] = emit;
  Module["printErr"] = function (line) {
    emit("info string " + line);
  };

  // A message to ourselves is the fastest way through the event loop; every few
  // rounds a timer is used instead, so that timers and I/O are served as well.
  var channel = typeof MessageChannel === "function" ? new MessageChannel() : null;
  var wake = null;
  var yields = 0;
  if (channel) {
    channel.port1.onmessage = function () {
      var w = wake;
      wake = null;
      if (w) w();
    };
  }
  Module["caissaYield"] = function (wakeUp) {
    if (!channel || ++yields % 8 === 0) {
      setTimeout(wakeUp, 0);
    } else {
      wake = wakeUp;
      channel.port2.postMessage(0);
    }
  };

  function pump() {
    if (!ready || busy || !queue.length) return;
    var line = queue.shift();
    busy = true;
    searching = /^(go|bench|benchmark)\b/.test(line);
    var done = function () {
      busy = false;
      searching = false;
      pump();
    };
    try {
      // ccall returns a promise when the search suspended itself, else the plain result.
      Promise.resolve(Module["ccall"]("caissa_command", "number", ["string"], [line], { async: true })).then(done, fatal);
    } catch (err) {
      fatal(err);
    }
  }

  function handle(line) {
    line = String(line).trim();
    if (!line) return;
    if (line === "quit" || line === "exit") {
      if (isNode) process.exit(0);
      else close();
      return;
    }
    if (line === "stop") {
      if (searching) HEAPU8[stopFlag] = 1;
      return;
    }
    if (line === "isready" && searching) {
      emit("readyok");
      return;
    }
    queue.push(line);
    pump();
  }

  // Copies the network into engine memory piece by piece, so that the file never
  // exists twice in JavaScript memory.
  function copyNet(source) {
    var size = Module["_caissa_net_size"]();
    var total = source.size !== undefined ? source.size : source.byteLength;
    if (total !== size) throw new Error("Caissa network has " + total + " bytes, expected " + size);
    var ptr = Module["_caissa_net_buffer"]();
    if (!ptr) throw new Error("Not enough memory for the Caissa network");
    if (source.byteLength !== undefined) {
      HEAPU8.set(source instanceof Uint8Array ? source : new Uint8Array(source), ptr);
      return Promise.resolve();
    }
    if (typeof source.stream !== "function") {
      return source.arrayBuffer().then(function (buf) {
        HEAPU8.set(new Uint8Array(buf), ptr);
      });
    }
    var reader = source.stream().getReader();
    var offset = 0;
    var step = function () {
      return reader.read().then(function (r) {
        if (r.done) return;
        HEAPU8.set(r.value, ptr + offset);
        offset += r.value.length;
        return step();
      });
    };
    return step();
  }

  function start() {
    if (ready || !runtimeUp || !net) return;
    var source = net;
    net = null;
    copyNet(source)
      .then(function () {
        if (!Module["_caissa_init"]()) throw new Error("Caissa network file is not valid");
        stopFlag = Module["_caissa_stop_flag"]();
        ready = true;
        pump();
      })
      .catch(fatal);
  }

  Module["onRuntimeInitialized"] = function () {
    runtimeUp = true;
    start();
  };

  if (isNode) {
    var fs = require("fs");
    var path = require("path");
    // Node's fetch() cannot read local files; hand the module over directly.
    Module["wasmBinary"] = fs.readFileSync(path.join(__dirname, "caissa.wasm"));
    net = fs.readFileSync(path.join(__dirname, NET_FILE));
    var pending = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", function (chunk) {
      pending += chunk;
      var i;
      while ((i = pending.indexOf("\n")) >= 0) {
        handle(pending.slice(0, i));
        pending = pending.slice(i + 1);
      }
    });
    process.stdin.on("end", function () {
      process.exit(0);
    });
  } else {
    onmessage = function (e) {
      var data = e.data;
      if (data && typeof data === "object" && data.net) {
        net = data.net;
        start();
      } else if (typeof data === "string") {
        var lines = data.split("\n");
        for (var i = 0; i < lines.length; i++) handle(lines[i]);
      }
    };
  }
})();
