import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

// Initialize Express application
const app = express();
// Enable CORS for all routes
app.use(cors());
// Enable JSON body parsing for Express
app.use(express.json());


// Simple in-memory storage for project list
let projects = [
    { id: 1, title: 'Test Project' }
];

// === EXPRESS ROUTES ===

// GET endpoint to retrieve the list of projects
app.get('/projects', (req, res) => {
    res.json(projects);
});

// POST endpoint to create a new project
app.post('/projects', (req, res) => {
    const newProject = {
        id: projects.length + 1,
        title: req.body.title // Expects { "title": "New Title" } in the request body
    };
    projects.push(newProject);
    res.json(newProject);
});

// === SOCKET.IO SETUP ===

// Create an HTTP server instance using the Express app
const server = http.createServer(app);
// Initialize Socket.IO server and enable CORS for client connections
const io = new Server(server, {
    cors: { origin: '*' }
});

// In-memory storage for the state of 3D objects and other project data
// Format: { projectId: { position: {...}, rotation: {...}, scale: {...}, annotations: [...] } }
const projectStates = {};

io.on('connection', (socket) => {
    console.log('🟢 User connected:', socket.id);

    // Event handler when a user joins a specific project room
    socket.on('joinProject', (projectId) => {
        socket.join(projectId);
        console.log(`👥 ${socket.id} joined project ${projectId}`);

        // Initialize project state if it doesn't exist
        if (!projectStates[projectId]) {
            projectStates[projectId] = { annotations: [] };
        }

        // Send existing annotations to the joining user
        socket.emit('loadAnnotations', {
            projectId,
            annotations: projectStates[projectId].annotations || [],
        })

        // Send the current state of the main object (e.g., cube) to the joining user
        if (projectStates[projectId]) {
            socket.emit('objectUpdated', {
                projectId,
                ...projectStates[projectId],
            });
        }
    });

    // Event handler when an object's position/rotation/scale is updated by a user
    socket.on('updateObject', (data) => {
        const { projectId, position, rotation, scale } = data;

        // Ensure state object exists
        if (!projectStates[projectId]) {
            projectStates[projectId] = {};
        }

        // Update the server's in-memory state
        projectStates[projectId].position = position;
        projectStates[projectId].rotation = rotation;
        projectStates[projectId].scale = scale;

        // Broadcast the update to all other users in the same room (project)
        socket.to(projectId).emit('objectUpdated', data);
    });

    // Event handler for synchronizing camera position (useful for "follow me" features)
    socket.on('updateCamera', (data) => {
        // Broadcast the camera update to all others in the room
        socket.to(data.projectId).emit('cameraUpdated', data);
    });

    // Event handler when a user disconnects
    socket.on('disconnect', () => {
        console.log('🔴 User disconnected:', socket.id);
    });

    // Event handler for adding a new annotation to the project
    socket.on('addAnnotation', (data) => {
        const { projectId, annotation } = data;

        // Ensure state object exists (initialization)
        if (!projectStates[projectId]) {
            projectStates[projectId] = {};
        }

        // Ensure annotations array exists
        if (!projectStates[projectId].annotations) {
            projectStates[projectId].annotations = [];
        }

        // Add the new annotation to the server state
        projectStates[projectId].annotations.push(annotation);

        // Broadcast the new annotation to all other users in the project
        socket.to(projectId).emit('annotationAdded', data);
    });

});

// === SERVER STARTUP ===

const PORT = 4000;
server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));