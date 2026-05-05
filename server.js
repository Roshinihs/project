const express = require("express");
const multer = require("multer");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");
const cors = require("cors");
const path = require("path");
const QRCode = require("qrcode");

const app = express();
const PORT = process.env.PORT || 3000;

const publicDir = path.join(__dirname, "public");
const uploadDir = path.join(__dirname, "uploads");
const certDir = path.join(__dirname, "certificates");
const qrDir = path.join(publicDir, "qrcodes");

const wipeModes = {
  quick: { label: "Quick Wipe", passes: 1 },
  secure: { label: "Secure Wipe", passes: 3 },
  military: { label: "Military Wipe", passes: 7 },
};

for (const dir of [uploadDir, certDir, qrDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${crypto.randomUUID()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

function getMode(value) {
  return wipeModes[value] ? value : "quick";
}

function buildSignaturePayload(certificate) {
  return [
    certificate.file,
    certificate.sizeBytes,
    certificate.time,
    certificate.mode,
    certificate.passes,
    certificate.status,
  ].join("|");
}

function generateHash(certificate) {
  return crypto
    .createHash("sha256")
    .update(buildSignaturePayload(certificate))
    .digest("hex");
}

function generateCertificateId(fileName, time) {
  return crypto
    .createHash("sha256")
    .update(`${fileName}|${time}|${crypto.randomUUID()}`)
    .digest("hex")
    .slice(0, 16);
}

function getCertificatePath(id) {
  if (!/^[a-f0-9]{16}$/i.test(id)) {
    return null;
  }

  return path.join(certDir, `${id}.json`);
}

function verifyCertificate(certificate) {
  if (!certificate || typeof certificate !== "object") {
    return { valid: false, reason: "Certificate data is missing." };
  }

  const requiredFields = ["file", "sizeBytes", "time", "mode", "passes", "status", "hash"];
  const missingFields = requiredFields.filter((field) => certificate[field] === undefined);

  if (missingFields.length > 0) {
    return {
      valid: false,
      reason: `Missing field(s): ${missingFields.join(", ")}.`,
    };
  }

  const mode = wipeModes[certificate.mode];
  if (!mode || Number(certificate.passes) !== mode.passes) {
    return { valid: false, reason: "Wipe mode does not match the pass count." };
  }

  const expectedHash = generateHash({
    file: certificate.file,
    sizeBytes: Number(certificate.sizeBytes),
    time: certificate.time,
    mode: certificate.mode,
    passes: Number(certificate.passes),
    status: certificate.status,
  });

  return {
    valid: expectedHash === certificate.hash,
    reason: expectedHash === certificate.hash ? "Certificate is valid." : "Certificate hash does not match.",
  };
}

async function wipeUploadedFile(filePath, passes) {
  const stats = await fsp.stat(filePath);
  const handle = await fsp.open(filePath, "r+");

  try {
    const chunkSize = 1024 * 1024;

    for (let pass = 0; pass < passes; pass += 1) {
      let written = 0;

      while (written < stats.size) {
        const length = Math.min(chunkSize, stats.size - written);
        const randomBytes = crypto.randomBytes(length);

        await handle.write(randomBytes, 0, length, written);
        written += length;
      }

      await handle.sync();
    }
  } finally {
    await handle.close();
  }

  await fsp.unlink(filePath);
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Data wiping server is running." });
});

async function handleWipe(req, res) {
  const uploadedFile = req.file;

  try {
    if (!uploadedFile) {
      return res.status(400).json({ error: "Please choose a file to wipe." });
    }

    const modeKey = getMode(req.body.mode);
    const mode = wipeModes[modeKey];
    const startTime = Date.now();
    const time = new Date().toISOString();

    await wipeUploadedFile(uploadedFile.path, mode.passes);

    const id = generateCertificateId(uploadedFile.originalname, time);
    const certificate = {
      id,
      file: uploadedFile.originalname,
      size: `${uploadedFile.size} bytes`,
      sizeBytes: uploadedFile.size,
      time,
      duration: `${((Date.now() - startTime) / 1000).toFixed(2)} sec`,
      mode: modeKey,
      method: `${mode.label} (${mode.passes} ${mode.passes === 1 ? "pass" : "passes"})`,
      passes: mode.passes,
      status: "Securely Wiped",
    };

    certificate.hash = generateHash(certificate);
    certificate.verifyUrl = `${req.protocol}://${req.get("host")}/verify.html?id=${id}`;
    certificate.qr = `/qrcodes/${id}.png`;

    await QRCode.toFile(path.join(qrDir, `${id}.png`), certificate.verifyUrl, {
      margin: 2,
      width: 280,
    });

    await fsp.writeFile(
      path.join(certDir, `${id}.json`),
      JSON.stringify(certificate, null, 2),
      "utf8"
    );

    res.json(certificate);
  } catch (error) {
    if (uploadedFile && fs.existsSync(uploadedFile.path)) {
      await fsp.unlink(uploadedFile.path).catch(() => {});
    }

    console.error("Wipe failed:", error);
    res.status(500).json({ error: "The file could not be wiped. Please try again." });
  }
}

app.post("/api/wipe", upload.single("file"), handleWipe);
app.post("/wipe", upload.single("file"), handleWipe);

function handleVerify(req, res) {
  const result = verifyCertificate(req.body);
  res.json(result);
}

app.post("/api/verify", handleVerify);
app.post("/verify", handleVerify);

app.get("/api/certificates/:id", async (req, res) => {
  const certificatePath = getCertificatePath(req.params.id);

  if (!certificatePath) {
    return res.status(400).json({ error: "Invalid certificate id." });
  }

  try {
    const certificate = JSON.parse(await fsp.readFile(certificatePath, "utf8"));
    res.json(certificate);
  } catch (error) {
    res.status(404).json({ error: "Certificate not found." });
  }
});

app.get("/api/certificates/:id/verify", async (req, res) => {
  const certificatePath = getCertificatePath(req.params.id);

  if (!certificatePath) {
    return res.status(400).json({ valid: false, reason: "Invalid certificate id." });
  }

  try {
    const certificate = JSON.parse(await fsp.readFile(certificatePath, "utf8"));
    res.json({ ...verifyCertificate(certificate), certificate });
  } catch (error) {
    res.status(404).json({ valid: false, reason: "Certificate not found." });
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.message });
  }

  next(error);
});

function startServer(port, allowFallback = true) {
  const server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && allowFallback) {
      const fallbackPort = Number(port) + 1;
      console.log(`Port ${port} is busy. Trying http://localhost:${fallbackPort}`);
      startServer(fallbackPort, false);
      return;
    }

    throw error;
  });
}

startServer(Number(PORT));
