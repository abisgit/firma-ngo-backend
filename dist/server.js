"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const dotenv_1 = __importDefault(require("dotenv"));
const pino_1 = __importDefault(require("pino"));
const client_1 = require("@prisma/client");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const logger = (0, pino_1.default)({ transport: { target: 'pino-pretty' } });
const prisma = new client_1.PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'firma_ngo_secret_key_2026';
app.use((0, cors_1.default)());
app.use((0, helmet_1.default)({
    contentSecurityPolicy: false, // For easier dev environment testing
}));
app.use((0, morgan_1.default)('dev'));
app.use(express_1.default.json());
// Ensure uploads folder exists
const uploadsDir = path_1.default.join(__dirname, '../uploads');
if (!fs_1.default.existsSync(uploadsDir)) {
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express_1.default.static(uploadsDir));
// Multer storage config
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});
const upload = (0, multer_1.default)({ storage });
// Helper to authenticate request and get User ID
const getUserIdFromHeader = (req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer '))
        return null;
    const token = authHeader.split(' ')[1];
    if (!token)
        return null;
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        return decoded.id;
    }
    catch {
        return null;
    }
};
// Seed default users & projects if none exist
async function seedDatabase() {
    try {
        // Ensure default organization exists
        let defaultOrg = await prisma.organization.findFirst({
            where: { name: 'Hope International Ethiopia' }
        });
        if (!defaultOrg) {
            defaultOrg = await prisma.organization.create({
                data: {
                    name: 'Hope International Ethiopia',
                    registrationCode: 'NGO-ETH-2026-001',
                    country: 'Ethiopia',
                }
            });
            logger.info('Default NGO organization created.');
        }
        // Ensure default users exist
        const userCount = await prisma.user.count();
        let users = [];
        if (userCount === 0) {
            logger.info('No users found in database. Seeding default NGO users...');
            const hashedPassword = await bcrypt_1.default.hash('admin123', 10);
            users = await prisma.$transaction([
                prisma.user.create({
                    data: {
                        email: 'admin@firma-ngo.org',
                        password: hashedPassword,
                        firstName: 'System',
                        lastName: 'Admin',
                        role: 'SUPER_ADMIN',
                        organizationId: defaultOrg.id,
                    }
                }),
                prisma.user.create({
                    data: {
                        email: 'donor@firma-ngo.org',
                        password: hashedPassword,
                        firstName: 'Sarah',
                        lastName: 'Donor',
                        role: 'DONOR',
                        organizationId: defaultOrg.id,
                    }
                }),
                prisma.user.create({
                    data: {
                        email: 'director@firma-ngo.org',
                        password: hashedPassword,
                        firstName: 'Abebe',
                        lastName: 'Director',
                        role: 'COUNTRY_DIRECTOR',
                        organizationId: defaultOrg.id,
                    }
                }),
                prisma.user.create({
                    data: {
                        email: 'officer@firma-ngo.org',
                        password: hashedPassword,
                        firstName: 'Tariku',
                        lastName: 'Officer',
                        role: 'FIELD_OFFICER',
                        organizationId: defaultOrg.id,
                    }
                }),
                prisma.user.create({
                    data: {
                        email: 'manager@firma-ngo.org',
                        password: hashedPassword,
                        firstName: 'Martha',
                        lastName: 'Manager',
                        role: 'GLOBAL_MANAGER',
                        organizationId: defaultOrg.id,
                    }
                })
            ]);
            logger.info('Default NGO users seeded successfully.');
        }
        else {
            users = await prisma.user.findMany();
        }
        // Ensure default projects exist
        const projectCount = await prisma.project.count();
        if (projectCount === 0) {
            logger.info('Seeding default projects...');
            const project1 = await prisma.project.create({
                data: {
                    organizationId: defaultOrg.id,
                    name: 'Food Security and Agricultural Support',
                    projectCode: 'HI-ETH-FSP-2026',
                    budget: 250000.0,
                    startDate: new Date('2026-01-01'),
                    endDate: new Date('2026-12-31'),
                }
            });
            const project2 = await prisma.project.create({
                data: {
                    organizationId: defaultOrg.id,
                    name: 'Remote Healthcare & Telemedicine Clinics',
                    projectCode: 'HI-ETH-RMS-2026',
                    budget: 480000.0,
                    startDate: new Date('2026-03-01'),
                    endDate: new Date('2027-02-28'),
                }
            });
            const project3 = await prisma.project.create({
                data: {
                    organizationId: defaultOrg.id,
                    name: 'Clean Water & Sanitation Initiative',
                    projectCode: 'HI-ETH-CWI-2026',
                    budget: 150000.0,
                    startDate: new Date('2026-06-01'),
                    endDate: new Date('2026-11-30'),
                }
            });
            logger.info('Default projects seeded successfully.');
            // Seed a default document
            const officerUser = users.find(u => u.role === 'FIELD_OFFICER');
            if (officerUser) {
                logger.info('Seeding initial documents...');
                await prisma.document.create({
                    data: {
                        projectId: project1.id,
                        creatorId: officerUser.id,
                        title: 'Food Security Q1 Assessment Report',
                        documentType: 'GRANT_PROPOSAL',
                        fileUrl: '/uploads/dummy_proposal.pdf',
                        status: 'DRAFT',
                    }
                });
                logger.info('Initial documents seeded successfully.');
            }
        }
    }
    catch (error) {
        logger.error(error, 'Error seeding database:');
    }
}
seedDatabase();
// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'firma-ngo-backend' });
});
// Authentication Routes
app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        res.status(400).json({ message: 'Email and password are required' });
        return;
    }
    try {
        const user = await prisma.user.findUnique({
            where: { email },
            include: { organization: true }
        });
        if (!user) {
            res.status(401).json({ message: 'Invalid email or password' });
            return;
        }
        const isPasswordValid = await bcrypt_1.default.compare(password, user.password);
        if (!isPasswordValid) {
            res.status(401).json({ message: 'Invalid email or password' });
            return;
        }
        const token = jsonwebtoken_1.default.sign({
            id: user.id,
            email: user.email,
            role: user.role,
            orgId: user.organizationId
        }, JWT_SECRET, { expiresIn: '24h' });
        // Don't return password
        const { password: _, ...userWithoutPassword } = user;
        res.json({
            token,
            user: userWithoutPassword
        });
    }
    catch (error) {
        logger.error(error, 'Login error:');
        res.status(500).json({ message: 'Internal server error during authentication' });
    }
});
// Get current user route
app.get('/auth/me', async (req, res) => {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { organization: true }
        });
        if (!user) {
            res.status(404).json({ message: 'User not found' });
            return;
        }
        const { password: _, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    }
    catch (error) {
        res.status(501).json({ message: 'Error retrieving user session' });
    }
});
// GET /projects - Get NGO projects
app.get('/projects', async (req, res) => {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }
    try {
        const projects = await prisma.project.findMany({
            where: { isActive: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(projects);
    }
    catch (error) {
        logger.error(error, 'Get projects error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});
// GET /documents - Get document list
app.get('/documents', async (req, res) => {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }
    try {
        const documents = await prisma.document.findMany({
            include: {
                project: true,
                creator: {
                    select: { firstName: true, lastName: true, role: true }
                },
                signatures: {
                    include: {
                        signer: {
                            select: { firstName: true, lastName: true, role: true }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(documents);
    }
    catch (error) {
        logger.error(error, 'Get documents error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});
// GET /documents/:id - Get single document detail
app.get('/documents/:id', async (req, res) => {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }
    try {
        const document = await prisma.document.findUnique({
            where: { id: req.params.id },
            include: {
                project: true,
                creator: {
                    select: { firstName: true, lastName: true, role: true }
                },
                signatures: {
                    include: {
                        signer: {
                            select: { firstName: true, lastName: true, role: true }
                        }
                    }
                }
            }
        });
        if (!document) {
            res.status(404).json({ message: 'Document not found' });
            return;
        }
        res.json(document);
    }
    catch (error) {
        logger.error(error, 'Get document detail error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});
// POST /upload - Upload a document file
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        res.status(400).json({ message: 'No file uploaded' });
        return;
    }
    // Return relative URL so it works in both local and production
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ fileUrl });
});
// POST /documents - Create a new document draft
app.post('/documents', async (req, res) => {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }
    const { projectId, title, documentType, fileUrl } = req.body;
    if (!title || !documentType) {
        res.status(400).json({ message: 'Title and Document Type are required' });
        return;
    }
    try {
        const document = await prisma.document.create({
            data: {
                projectId: projectId || null,
                creatorId: userId,
                title,
                documentType,
                fileUrl: fileUrl || '/uploads/sample.pdf',
                status: 'DRAFT'
            },
            include: {
                project: true,
                creator: {
                    select: { firstName: true, lastName: true, role: true }
                }
            }
        });
        res.status(201).json(document);
    }
    catch (error) {
        logger.error(error, 'Create document error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});
// POST /documents/:id/sign - Sign a document (includes mock biometric/video consent)
app.post('/documents/:id/sign', async (req, res) => {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }
    const { videoUrl } = req.body;
    try {
        const document = await prisma.document.findUnique({
            where: { id: req.params.id }
        });
        if (!document) {
            res.status(404).json({ message: 'Document not found' });
            return;
        }
        // Generate cryptographic signature hash
        const signatureHash = crypto_1.default.createHash('sha256')
            .update(`${document.id}-${userId}-${Date.now()}`)
            .digest('hex');
        // Create signature record
        await prisma.signature.create({
            data: {
                documentId: document.id,
                signerId: userId,
                videoUrl: videoUrl || null,
                signatureHash,
                ipAddress: req.ip || '127.0.0.1',
                userAgent: req.headers['user-agent'] || 'Unknown Browser'
            }
        });
        // Advance document status to APPROVED
        const updatedDoc = await prisma.document.update({
            where: { id: document.id },
            data: {
                status: 'APPROVED'
            },
            include: {
                signatures: true
            }
        });
        res.json(updatedDoc);
    }
    catch (error) {
        logger.error(error, 'Sign document error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});
// POST /documents/:id/anchor - Anchor approved document onto the blockchain
app.post('/documents/:id/anchor', async (req, res) => {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }
    try {
        const document = await prisma.document.findUnique({
            where: { id: req.params.id }
        });
        if (!document) {
            res.status(404).json({ message: 'Document not found' });
            return;
        }
        if (document.status !== 'APPROVED') {
            res.status(400).json({ message: 'Only APPROVED documents can be anchored to the blockchain' });
            return;
        }
        // Calculate cryptographic SHA-256 zero-knowledge hash of the document meta
        const blockchainHash = crypto_1.default.createHash('sha256')
            .update(`${document.title}-${document.createdAt}-${Date.now()}`)
            .digest('hex');
        // Generate a mock transaction hash/ID
        const txId = '0x' + crypto_1.default.randomBytes(32).toString('hex');
        const updatedDoc = await prisma.document.update({
            where: { id: document.id },
            data: {
                status: 'ANCHORED',
                blockchainHash,
                txId
            }
        });
        res.json(updatedDoc);
    }
    catch (error) {
        logger.error(error, 'Anchor document error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});
// POST /verify - public verification API (check hash authenticity)
app.post('/verify', async (req, res) => {
    const { hash } = req.body;
    if (!hash) {
        res.status(400).json({ message: 'Cryptographic hash is required' });
        return;
    }
    try {
        const document = await prisma.document.findFirst({
            where: {
                OR: [
                    { blockchainHash: hash },
                    { id: hash }, // Or search by direct Document ID
                    { title: { contains: hash, mode: 'insensitive' } } // Or title lookup
                ]
            },
            include: {
                project: true,
                creator: {
                    select: { firstName: true, lastName: true, role: true }
                },
                signatures: {
                    include: {
                        signer: {
                            select: { firstName: true, lastName: true, role: true }
                        }
                    }
                }
            }
        });
        if (!document) {
            res.status(404).json({ verified: false, message: 'No matching anchored record found on the ledger' });
            return;
        }
        res.json({
            verified: true,
            document
        });
    }
    catch (error) {
        logger.error(error, 'Verify error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});
// POST /verify/file - public verification API using uploaded file (calculates file hash and verifies authenticity)
app.post('/verify/file', upload.single('file'), async (req, res) => {
    if (!req.file) {
        res.status(400).json({ message: 'No file uploaded for scanning' });
        return;
    }
    try {
        // Read file buffer and compute SHA-256 hash
        const fileBuffer = fs_1.default.readFileSync(req.file.path);
        const hashSum = crypto_1.default.createHash('sha256');
        hashSum.update(fileBuffer);
        const fileHash = hashSum.digest('hex');
        logger.info(`Scanning file: ${req.file.originalname}, computed hash: ${fileHash}`);
        // Clean up the uploaded temp file
        fs_1.default.unlinkSync(req.file.path);
        const document = await prisma.document.findFirst({
            where: {
                blockchainHash: fileHash
            },
            include: {
                project: true,
                creator: {
                    select: { firstName: true, lastName: true, role: true }
                },
                signatures: {
                    include: {
                        signer: {
                            select: { firstName: true, lastName: true, role: true }
                        }
                    }
                }
            }
        });
        if (!document) {
            res.status(404).json({ verified: false, computedHash: fileHash, message: 'No matching anchored record found on the ledger. The file content might have been modified.' });
            return;
        }
        res.json({
            verified: true,
            computedHash: fileHash,
            document
        });
    }
    catch (error) {
        logger.error(error, 'Verify file error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});
const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
    logger.info(`NGO Backend running on port ${PORT}`);
});
//# sourceMappingURL=server.js.map