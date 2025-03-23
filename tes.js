const cluster = require("cluster");
const os = require("os");

if (cluster.isMaster) {
  console.log("Master PID:", process.pid);
  console.log("Argumen pertama:", process.argv[2]);

  // Fork worker dan kirim argumen lewat env
  for (let i = 0; i < 2; i++) {
    cluster.fork({ ARG_FROM_MASTER: process.argv[2] });
  }

  cluster.on("exit", (worker) => {
    console.log(`Worker ${worker.process.pid} mati`);
  });
} else {
  console.log(`Worker ${process.pid} berjalan dengan argumen: ${process.env.ARG_FROM_MASTER}`);
}
