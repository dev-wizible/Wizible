// src/index.ts
import express from "express";
import extractRoutes from "./extractRoute";
import fs from "fs";
import cors from "cors";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));
if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads");
app.use("/api", extractRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
