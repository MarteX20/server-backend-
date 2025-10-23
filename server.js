import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";

import multer from "multer";
import path from "path";
import fs from "fs";


dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// === CONNECT TO MONGO ATLAS ===
const client = new MongoClient(process.env.MONGO_URI);
await client.connect();
const db = client.db("collab3d");
const projectsCollection = db.collection("projects");
console.log("✅ Connected to MongoDB Atlas ====================");

// === EXPRESS ROUTES ===

// Get all projects
app.get("/projects", async (req, res) => {
    const projects = await projectsCollection.find().toArray();
    res.json(projects);
});

// Create a new project
app.post("/projects", async (req, res) => {
    const { title } = req.body;
    const newProject = {
        title,
        state: {
            object: {
                position: { x: 0, y: 0.5, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
            },
            annotations: [],
            chat: [],
            camera: null,
        },
        createdAt: new Date(),
    };
    const result = await projectsCollection.insertOne(newProject);
    res.json({ _id: result.insertedId, ...newProject });
});

// DELETE project by ID
app.delete("/projects/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const result = await projectsCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 1) {
            console.log(`🗑️ Project ${id} deleted`);
            res.json({ success: true, message: "Project deleted" });
        } else {
            res.status(404).json({ success: false, message: "Project not found" });
        }
    } catch (error) {
        console.error("❌ Error deleting project:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// === FILE UPLOAD CONFIG ===
const uploadDir = "./uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const allowed = [".stl", ".stp"];
        const ext = path.extname(file.originalname).toLowerCase();
        allowed.includes(ext) ? cb(null, true) : cb(new Error("Only .stl and .stp files allowed"));
    }
});

// === UPLOAD ROUTE ===
app.post("/upload", upload.single("model"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ fileUrl });
});

app.use("/uploads", express.static(path.resolve("uploads")));


// === SOCKET.IO ===
io.on("connection", (socket) => {
    console.log("🟢 User connected:", socket.id);

    // Join project
    socket.on("joinProject", async (projectId) => {
        socket.join(projectId);
        console.log(`👥 ${socket.id} joined project ${projectId}`);

        const project = await projectsCollection.findOne({ _id: new ObjectId(projectId) });
        if (project) {
            socket.emit("loadProject", project.state);
        }
    });

    // Update object transform
    socket.on("updateObject", async ({ projectId, position, rotation, scale }) => {
        await projectsCollection.updateOne(
            { _id: new ObjectId(projectId) },
            { $set: { "state.object": { position, rotation, scale } } }
        );
        socket.to(projectId).emit("objectUpdated", { projectId, position, rotation, scale });
    });

    // Update camera
    socket.on("updateCamera", async ({ projectId, camera, socketId }) => {
        await projectsCollection.updateOne(
            { _id: new ObjectId(projectId) },
            { $set: { "state.camera": camera } }
        );
        socket.to(projectId).emit("cameraUpdated", { projectId, camera, socketId });
    });

    // Update cube color
    socket.on("updateCubeColor", async ({ projectId, color }) => {
        await projectsCollection.updateOne(
            { _id: new ObjectId(projectId) },
            { $set: { "state.object.color": color } }
        );

        io.to(projectId).emit("cubeColorUpdated", { projectId, color });
    });


    // Add annotation
    socket.on("addAnnotation", async ({ projectId, annotation }) => {
        await projectsCollection.updateOne(
            { _id: new ObjectId(projectId) },
            { $push: { "state.annotations": annotation } }
        );
        io.to(projectId).emit("annotationAdded", { projectId, annotation });
    });

    // Delete annotation
    socket.on("deleteAnnotation", async ({ projectId, annotationId }) => {
        await projectsCollection.updateOne(
            { _id: new ObjectId(projectId) },
            { $pull: { "state.annotations": { id: annotationId } } }
        );
        io.to(projectId).emit("annotationDeleted", { projectId, annotationId });
    });

    // Chat
    socket.on("sendMessage", async ({ projectId, message }) => {
        await projectsCollection.updateOne(
            { _id: new ObjectId(projectId) },
            { $push: { "state.chat": message } }
        );
        io.to(projectId).emit("receiveMessage", { projectId, message });
    });

    // Upload model
    socket.on("modelUploaded", async ({ projectId, fileUrl }) => {
        await projectsCollection.updateOne(
            { _id: new createFromTime(projectId) },
            {
                $set: {
                    "state.model": fileUrl,
                    "state.object": {
                        position: { x: 0, y: 0, z: 0 },
                        rotation: { x: 0, y: 0, z: 0 },
                        scale: { x: 1, y: 1, z: 1 },
                        color: "#00aaff",
                    },
                    "state.annotations": [],
                },
            }
        );

        io.to(projectId).emit("modelLoaded", { projectId, fileUrl });
    });



    socket.on("disconnect", () => {
        console.log("🔴 User disconnected:", socket.id);
    });
});

// === START SERVER ===
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
