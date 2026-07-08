const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Rrugë e thjeshtë sa për të parë nëse serveri është Live në Render
app.get('/', (req, res) => {
    res.send("Sistemi BiG CHaTT Backend është LIVE! 🚀");
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Lejon lidhjen nga çdo frontend
        methods: ["GET", "POST"]
    }
});

let onlineUsers = {}; // Ruhen përdoruesit aktivë { socketId: { username, country } }
let waitingQueue = []; // Radhë pritjeje për njerëzit që bëjnë kërkim (Start)

io.on('connection', (socket) => {
    console.log(`Përdorues i ri u lidh: ${socket.id}`);

    // Kur përdoruesi hyn në sistem (Login)
    socket.on('user-login', (data) => {
        onlineUsers[socket.id] = {
            username: data.username,
            country: data.city, // Këtu vjen lokacioni ose qyteti
            currentRoom: null
        };
        // Përditëso numrin online te të gjithë
        io.emit('users-count-update', Object.keys(onlineUsers).length);
    });

    // 1. LOGJIKA E KËRKIMIT REAL-TIME (MATCHING LOGIC)
    socket.on('find-random-partner', (data) => {
        const user = onlineUsers[socket.id];
        if (!user) return;

        // Nëse përdoruesi është aktualisht në një dhomë, e heqim nga ajo dhomë para se të kërkojë tjetër
        if (user.currentRoom) {
            leaveCurrentChat(socket);
        }

        // Kontrollojmë nëse ka dikë tjetër në radhë që po pret
        // Filtri i shtetit (nëse nuk është 'all')
        let partnerIndex = -1;
        if (data.filter && data.filter !== 'all') {
            partnerIndex = waitingQueue.findIndex(id => {
                const wUser = onlineUsers[id];
                return wUser && id !== socket.id && wUser.country.toLowerCase().includes(data.filter.toLowerCase());
            });
        } else {
            // Merr të parin në radhë që nuk është vetvetja
            partnerIndex = waitingQueue.findIndex(id => id !== socket.id);
        }

        if (partnerIndex !== -1) {
            // U gjet një partner!
            const partnerId = waitingQueue.splice(partnerIndex, 1)[0];
            const partnerUser = onlineUsers[partnerId];

            if (partnerUser) {
                const roomName = `room_${socket.id}_${partnerId}`;
                
                socket.join(roomName);
                io.sockets.sockets.get(partnerId)?.join(roomName);

                user.currentRoom = roomName;
                partnerUser.currentRoom = roomName;
                user.partnerId = partnerId;
                partnerUser.partnerId = socket.id;

                // Njofto të dy përdoruesit që biseda filloi
                socket.emit('chat-started', { username: partnerUser.username, country: partnerUser.country });
                io.to(partnerId).emit('chat-started', { username: user.username, country: user.country });
            }
        } else {
            // Nuk ka asnjë të lirë, shtoje këtë përdorues në radhë pritjeje
            if (!waitingQueue.includes(socket.id)) {
                waitingQueue.push(socket.id);
            }
        }
    });

    // 2. LOGJIKA KUR NJËRI SHTYP SKIP
    socket.on('skip-partner', () => {
        leaveCurrentChat(socket);
    });

    // 3. DËRGIMI I DHURATAVE LIVE PËRMES SERVERIT
    socket.on('send-live-gift', (data) => {
        const user = onlineUsers[socket.id];
        if (user && user.partnerId) {
            // Dërgo dhuratën direkt te partneri në kohë reale
            io.to(user.partnerId).emit('gift-received', {
                icon: data.icon,
                message: `${user.username} të dërgoi një ${data.message}!`
            });
        }
    });

    // KICK / BAN NGA ADMINI (FLORIAN)
    socket.on('admin-kick-ban', (data) => {
        const targetUsername = data.target.toLowerCase();
        // Gjejmë socket-in e përdoruesit të raportuar për t'i bërë disconnect menjëherë
        for (let id in onlineUsers) {
            if (onlineUsers[id].username.toLowerCase() === targetUsername) {
                io.to(id).emit('partner-disconnected'); // nëse ishte në bisedë
                io.sockets.sockets.get(id)?.disconnect();
                break;
            }
        }
    });

    // LOGJIKA KUR IKËN NGAlIDHJA (Mbyll tab-in ose disconnect)
    socket.on('disconnect', () => {
        console.log(`Përdoruesi u shkëput: ${socket.id}`);
        leaveCurrentChat(socket);
        
        // Hiqe nga lista online
        delete onlineUsers[socket.id];
        
        // Përditëso numrin e përdoruesve online
        io.emit('users-count-update', Object.keys(onlineUsers).length);
    });
});

// Funksion ndihmës për të pastruar dhomën dhe njoftuar tjetrin
function leaveCurrentChat(socket) {
    // Hiqe nga radha e pritjes nëse ishte duke prit
    waitingQueue = waitingQueue.filter(id => id !== socket.id);

    const user = onlineUsers[socket.id];
    if (user && user.currentRoom) {
        const partnerId = user.partnerId;
        
        // Njofto partnerin që ky përdorues iku / bëri skip
        if (partnerId && onlineUsers[partnerId]) {
            io.to(partnerId).emit('partner-disconnected');
            onlineUsers[partnerId].currentRoom = null;
            onlineUsers[partnerId].partnerId = null;
            io.sockets.sockets.get(partnerId)?.leave(user.currentRoom);
        }

        socket.leave(user.currentRoom);
        user.currentRoom = null;
        user.partnerId = null;
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveri po rreh në portin ${PORT} 🚀`);
});
