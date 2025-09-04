// server.js
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

let targetNumber = 0n; // BigInt
let currentRange = 1n; // BigInt
let completedRanges = new Set();
let workers = new Map();
let isFactored = false;
let factorFound = null;
let totalRanges = 0n; // BigInt
let startTime = Date.now();

// Read target number from file (as string to preserve precision)
function loadTargetNumber() {
    try {
        const numberString = fs.readFileSync('target.txt', 'utf8').trim();
        // Remove quotes if present
        const cleanNumber = numberString.replace(/["']/g, '');
        targetNumber = BigInt(cleanNumber);
        console.log(`Target number set to: ${targetNumber.toString()}`);
        resetFactoring(targetNumber);
    } catch (err) {
        console.error('Error reading target.txt:', err);
        process.exit(1);
    }
}

// Poll for number changes
setInterval(() => {
    try {
        const numberString = fs.readFileSync('target.txt', 'utf8').trim();
        const cleanNumber = numberString.replace(/["']/g, '');
        const newNumber = BigInt(cleanNumber);
        if (newNumber !== targetNumber) {
            console.log(`Target changed to: ${newNumber.toString()}`);
            loadTargetNumber();
        }
    } catch (err) {
        console.error('Error reading target.txt:', err);
    }
}, 5000);

function resetFactoring(newNumber) {
    targetNumber = newNumber;
    currentRange = 1n;
    completedRanges.clear();
    isFactored = false;
    factorFound = null;
    startTime = Date.now();
    
    // Calculate total ranges needed (sqrt(target) / 1000000)
    const sqrtTarget = sqrtBigint(targetNumber) + 1n;
    totalRanges = sqrtTarget / 1000000n + 1n;
    
    // Notify all clients of new task
    io.emit('new_task', {
        number: targetNumber.toString(), // Send as string
        start: currentRange.toString(),
        end: (currentRange + 999999n).toString(),
        totalRanges: totalRanges.toString()
    });
    
    currentRange += 1000000n;
}

// BigInt square root implementation
function sqrtBigint(n) {
    if (n < 0n) throw 'Square root of negative number';
    if (n < 2n) return n;
    
    function newtonIteration(n, x0) {
        const x1 = ((n / x0) + x0) >> 1n;
        if (x0 === x1 || x0 === (x1 - 1n)) {
            return x0;
        }
        return newtonIteration(n, x1);
    }
    
    return newtonIteration(n, 1n);
}

function getProgress() {
    if (totalRanges === 0n) return 0;
    return Math.min(100, Number((BigInt(completedRanges.size) * 100n) / totalRanges));
}

io.on('connection', (socket) => {
    console.log(`Worker ${socket.id} connected`);
    workers.set(socket.id, { socket, range: null });

    // Send current status to newly connected client
    if (isFactored && factorFound) {
        socket.emit('factored', { 
            factor: factorFound, 
            number: targetNumber.toString() 
        });
    } else {
        socket.emit('progress_update', {
            progress: getProgress(),
            completed: completedRanges.size,
            total: Number(totalRanges),
            elapsed: Date.now() - startTime
        });
    }

    socket.on('request_task', () => {
        if (isFactored) {
            socket.emit('factored', { 
                factor: factorFound, 
                number: targetNumber.toString() 
            });
            return;
        }
        
        const task = {
            number: targetNumber.toString(), // Send as string
            start: currentRange.toString(),
            end: (currentRange + 999999n).toString(),
            totalRanges: totalRanges.toString()
        };
        
        workers.get(socket.id).range = currentRange;
        socket.emit('new_task', task);
        currentRange += 1000000n;
    });

    socket.on('factor_found', (data) => {
        if (isFactored) return; // Prevent duplicate processing
        
        console.log(`Factor found: ${data.factor}`);
        isFactored = true;
        factorFound = data.factor;
        
        // Broadcast to all clients
        io.emit('factored', { 
            factor: data.factor, 
            number: targetNumber.toString() 
        });
        
        // Save result to file
        const targetStr = targetNumber.toString();
        const factorStr = data.factor;
        const otherFactor = (targetNumber / BigInt(data.factor)).toString();
        fs.appendFileSync('results.txt', `${targetStr} = ${factorStr} × ${otherFactor}\n`);
    });

    socket.on('task_complete', (data) => {
        completedRanges.add(data.start);
        
        // Broadcast progress update to all clients
        const progressData = {
            progress: getProgress(),
            completed: completedRanges.size,
            total: Number(totalRanges),
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
            currentRange = worker.range < currentRange ? worker.range : currentRange;
        }
        workers.delete(socket.id);
    });
});

loadTargetNumber();
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
