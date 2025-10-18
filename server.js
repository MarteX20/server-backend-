import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";

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

    socket.on("disconnect", () => {
        console.log("🔴 User disconnected:", socket.id);
    });
});

// === START SERVER ===
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
