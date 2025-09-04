const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static('public'));

let targetNumber = 0;
let currentRange = 1;
let completedRanges = new Set();
let workers = new Map();
let isFactored = false;

// Read target number from file
function loadTargetNumber() {
    try {
        targetNumber = parseInt(fs.readFileSync('target.txt', 'utf8').trim());
        console.log(`Target number set to: ${targetNumber}`);
    } catch (err) {
        console.error('Error reading target.txt:', err);
        process.exit(1);
    }
}

// Poll for number changes
setInterval(() => {
    const newNumber = parseInt(fs.readFileSync('target.txt', 'utf8').trim());
    if (newNumber !== targetNumber) {
        console.log(`Target changed to: ${newNumber}`);
        resetFactoring(newNumber);
    }
}, 5000);

function resetFactoring(newNumber) {
    targetNumber = newNumber;
    currentRange = 1;
    completedRanges.clear();
    isFactored = false;
    workers.forEach((_, socketId) => {
        io.to(socketId).emit('new_task', {
            number: targetNumber,
            start: currentRange,
            end: currentRange + 999999
        });
        currentRange += 1000000;
    });
}

io.on('connection', (socket) => {
    console.log(`Worker ${socket.id} connected`);
    workers.set(socket.id, { socket, range: null });

    socket.on('request_task', () => {
        if (isFactored) return;
        
        const task = {
            number: targetNumber,
            start: currentRange,
            end: currentRange + 999999
        };
        
        workers.get(socket.id).range = task.start;
        socket.emit('new_task', task);
        currentRange += 1000000;
    });

    socket.on('factor_found', (data) => {
        console.log(`Factor found: ${data.factor}`);
        isFactored = true;
        io.emit('factored', { factor: data.factor });
        fs.appendFileSync('results.txt', `${targetNumber} = ${data.factor} × ${targetNumber/data.factor}\n`);
    });

    socket.on('task_complete', (data) => {
        completedRanges.add(data.start);
        if (!isFactored) {
            socket.emit('request_task');
        }
    });

    socket.on('disconnect', () => {
        console.log(`Worker ${socket.id} disconnected`);
        const worker = workers.get(socket.id);
        if (worker && worker.range) {
            // Re-queue incomplete range
            currentRange = Math.min(currentRange, worker.range);
        }
        workers.delete(socket.id);
    });
});

loadTargetNumber();
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
