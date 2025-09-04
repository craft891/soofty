const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html at root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let targetNumber = 0;
let currentRange = 1;
let completedRanges = new Set();
let workers = new Map();
let isFactored = false;
let factorFound = null;
let totalRanges = 0;
let startTime = Date.now();

// Read target number from file
function loadTargetNumber() {
    try {
        targetNumber = parseInt(fs.readFileSync('target.txt', 'utf8').trim());
        console.log(`Target number set to: ${targetNumber}`);
        resetFactoring(targetNumber);
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
        loadTargetNumber();
    }
}, 5000);

function resetFactoring(newNumber) {
    targetNumber = newNumber;
    currentRange = 1;
    completedRanges.clear();
    isFactored = false;
    factorFound = null;
    totalRanges = 0;
    startTime = Date.now();
    
    // Calculate total ranges needed
    const sqrtTarget = Math.floor(Math.sqrt(targetNumber));
    totalRanges = Math.ceil(sqrtTarget / 1000000);
    
    // Notify all clients of new task
    io.emit('new_task', {
        number: targetNumber,
        start: currentRange,
        end: currentRange + 999999,
        totalRanges: totalRanges
    });
    
    currentRange += 1000000;
}

function getProgress() {
    if (totalRanges === 0) return 0;
    return Math.min(100, Math.round((completedRanges.size / totalRanges) * 100));
}

io.on('connection', (socket) => {
    console.log(`Worker ${socket.id} connected`);
    workers.set(socket.id, { socket, range: null });

    // Send current status to newly connected client
    if (isFactored && factorFound) {
        socket.emit('factored', { factor: factorFound });
    } else {
        socket.emit('progress_update', {
            progress: getProgress(),
            completed: completedRanges.size,
            total: totalRanges,
            elapsed: Date.now() - startTime
        });
    }

    socket.on('request_task', () => {
        if (isFactored) {
            socket.emit('factored', { factor: factorFound });
            return;
        }
        
        const task = {
            number: targetNumber,
            start: currentRange,
            end: currentRange + 999999,
            totalRanges: totalRanges
        };
        
        workers.get(socket.id).range = task.start;
        socket.emit('new_task', task);
        currentRange += 1000000;
    });

    socket.on('factor_found', (data) => {
        if (isFactored) return; // Prevent duplicate processing
        
        console.log(`Factor found: ${data.factor}`);
        isFactored = true;
        factorFound = data.factor;
        
        // Broadcast to all clients
        io.emit('factored', { factor: data.factor, number: targetNumber });
        
        // Save result to file
        const otherFactor = targetNumber / data.factor;
        fs.appendFileSync('results.txt', `${targetNumber} = ${data.factor} × ${otherFactor}\n`);
    });

    socket.on('task_complete', (data) => {
        completedRanges.add(data.start);
        
        // Broadcast progress update to all clients
        const progressData = {
            progress: getProgress(),
            completed: completedRanges.size,
            total: totalRanges,
            elapsed: Date.now() - startTime
        };
        
        io.emit('progress_update', progressData);
        
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
