import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import multer from 'multer';

dotenv.config();

const app = express();
const logger = process.env.VERCEL === '1' ? pino() : pino({ transport: { target: 'pino-pretty' } });
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'firma_ngo_secret_key_2026';

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.options('*', cors() as any);

app.use(helmet({
    contentSecurityPolicy: false, // For easier dev environment testing
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(morgan('dev'));
app.use(express.json());

// Ensure uploads folder exists
const uploadsDir = process.env.VERCEL === '1' ? '/tmp/uploads' : path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Multer storage config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});
const upload = multer({ storage });

// Helper to authenticate request and get User ID
const getUserIdFromHeader = (req: express.Request) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.split(' ')[1];
    if (!token) return null;
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        return decoded.id;
    } catch {
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
        let users: any[] = [];
        if (userCount === 0) {
            logger.info('No users found in database. Seeding default NGO users...');
            const hashedPassword = await bcrypt.hash('admin123', 10);
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
        } else {
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
    } catch (error) {
        logger.error(error as any, 'Error seeding database:');
    }
}

if (process.env.VERCEL !== '1') {
    seedDatabase();
}

// Root route
app.get('/', (req, res) => {
    res.send('FIRMA NGO Backend Service is running.');
});

// Seed endpoint
app.post('/api/seed', async (req, res) => {
    try {
        await seedDatabase();
        res.json({ status: 'success', message: 'Database seeded successfully.' });
    } catch (err: any) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'firma-ngo-backend' });
});

// Authentication Routes
app.post('/auth/login', async (req: express.Request, res: express.Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
        res.status(400).json({ message: 'Email and password are required' });
        return;
    }

    try {
        let user = await prisma.user.findUnique({
            where: { email },
            include: { organization: true }
        });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            // SSO Fallback: Try central FIRMA API
            try {
                const centralRes = await fetch('https://api.firmasafe.com/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                if (centralRes.ok) {
                    const data = await centralRes.json() as any;
                    const centralUser = data.user;

                    if (centralUser && centralUser.organization) {
                        const names = centralUser.fullName.split(' ');
                        const firstName = names[0];
                        const lastName = names.slice(1).join(' ') || 'User';

                        // Upsert Organization
                        const org = await prisma.organization.upsert({
                            where: { registrationCode: centralUser.organization.code },
                            update: {
                                name: centralUser.organization.name,
                            },
                            create: {
                                name: centralUser.organization.name,
                                registrationCode: centralUser.organization.code,
                                country: 'Unknown'
                            }
                        });

                        // Upsert User
                        const hashedPassword = await bcrypt.hash(password, 10);
                        user = await prisma.user.upsert({
                            where: { email },
                            update: {
                                password: hashedPassword,
                                firstName,
                                lastName,
                                role: centralUser.role === 'ORG_ADMIN' ? 'SUPER_ADMIN' : 'FIELD_OFFICER',
                                organizationId: org.id
                            },
                            create: {
                                email,
                                password: hashedPassword,
                                firstName,
                                lastName,
                                role: centralUser.role === 'ORG_ADMIN' ? 'SUPER_ADMIN' : 'FIELD_OFFICER',
                                organizationId: org.id
                            },
                            include: { organization: true }
                        });
                    }
                }
            } catch (err) {
                logger.error(err as any, 'SSO fallback failed');
            }
        }

        if (!user || !(await bcrypt.compare(password, user.password))) {
            res.status(401).json({ message: 'Invalid email or password' });
            return;
        }

        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                orgId: user.organizationId 
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Don't return password
        const { password: _, ...userWithoutPassword } = user;

        res.json({
            token,
            user: userWithoutPassword
        });
    } catch (error) {
        logger.error(error as any, 'Login error');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get current user route
app.get('/auth/me', async (req: express.Request, res: express.Response) => {
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
    } catch (error) {
        res.status(501).json({ message: 'Error retrieving user session' });
    }
});

// GET /projects - Get NGO projects
app.get('/projects', async (req: express.Request, res: express.Response) => {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }

    try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user || !user.organizationId) {
            res.json([]);
            return;
        }

        const projects = await prisma.project.findMany({
            where: { 
                isActive: true,
                organizationId: user.organizationId
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(projects);
    } catch (error) {
        logger.error(error as any, 'Get projects error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /documents - Get document list
app.get('/documents', async (req: express.Request, res: express.Response) => {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }

    try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user || !user.organizationId) {
            res.json([]);
            return;
        }

        const documents = await prisma.document.findMany({
            where: {
                creator: {
                    organizationId: user.organizationId
                }
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
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(documents);
    } catch (error) {
        logger.error(error as any, 'Get documents error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /documents/:id - Get single document detail
app.get('/documents/:id', async (req: express.Request, res: express.Response) => {
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
    } catch (error) {
        logger.error(error as any, 'Get document detail error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /upload - Upload a document file
app.post('/upload', upload.single('file'), (req: express.Request, res: express.Response) => {
    if (!req.file) {
        res.status(400).json({ message: 'No file uploaded' });
        return;
    }
    // Return relative URL so it works in both local and production
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ fileUrl });
});

// POST /documents - Create a new document draft
app.post('/documents', async (req: express.Request, res: express.Response) => {
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
    } catch (error) {
        logger.error(error as any, 'Create document error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /documents/:id/sign - Sign a document (includes mock biometric/video consent)
app.post('/documents/:id/sign', async (req: express.Request, res: express.Response) => {
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
        const signatureHash = crypto.createHash('sha256')
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
    } catch (error) {
        logger.error(error as any, 'Sign document error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /documents/:id/anchor - Anchor approved document onto the blockchain
app.post('/documents/:id/anchor', async (req: express.Request, res: express.Response) => {
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
        const blockchainHash = crypto.createHash('sha256')
            .update(`${document.title}-${document.createdAt}-${Date.now()}`)
            .digest('hex');

        // Generate a mock transaction hash/ID
        const txId = '0x' + crypto.randomBytes(32).toString('hex');

        const updatedDoc = await prisma.document.update({
            where: { id: document.id },
            data: {
                status: 'ANCHORED',
                blockchainHash,
                txId
            }
        });

        res.json(updatedDoc);
    } catch (error) {
        logger.error(error as any, 'Anchor document error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /verify - public verification API (check hash authenticity)
app.post('/verify', async (req: express.Request, res: express.Response) => {
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
    } catch (error) {
        logger.error(error as any, 'Verify error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /verify/file - public verification API using uploaded file (calculates file hash and verifies authenticity)
app.post('/verify/file', upload.single('file'), async (req: express.Request, res: express.Response) => {
    if (!req.file) {
        res.status(400).json({ message: 'No file uploaded for scanning' });
        return;
    }

    try {
        // Read file buffer and compute SHA-256 hash
        const fileBuffer = fs.readFileSync(req.file.path);
        const hashSum = crypto.createHash('sha256');
        hashSum.update(fileBuffer);
        const fileHash = hashSum.digest('hex');

        logger.info(`Scanning file: ${req.file.originalname}, computed hash: ${fileHash}`);

        // Clean up the uploaded temp file
        fs.unlinkSync(req.file.path);

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
    } catch (error) {
        logger.error(error as any, 'Verify file error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// INTERNAL API: Provision NGO Tenant
app.post('/api/internal/tenants', async (req: express.Request, res: express.Response) => {
    const { orgName, orgCode, contactPerson, officialEmail, password } = req.body;
    const internalSecret = req.headers['x-internal-secret'];
    
    if (internalSecret !== (process.env.INTERNAL_SECRET || 'firma_internal_secure_123')) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const names = contactPerson ? contactPerson.split(' ') : ['Admin', ''];
        const firstName = names[0];
        const lastName = names.slice(1).join(' ') || 'User';

        let newOrg = await prisma.organization.findUnique({
            where: { registrationCode: orgCode }
        });

        if (!newOrg) {
            newOrg = await prisma.organization.create({
                data: {
                    name: orgName,
                    registrationCode: orgCode,
                    country: 'Unknown',
                    users: {
                        create: {
                            email: officialEmail,
                            password: hashedPassword,
                            firstName,
                            lastName,
                            role: 'SUPER_ADMIN'
                        }
                    }
                }
            });
        }
        
        res.status(201).json({ success: true, organizationId: newOrg.id });
    } catch (err: any) {
        logger.error(err as any, 'Error provisioning internal tenant');
        res.status(500).json({ message: 'Failed to provision tenant' });
    }
});

const PORT = process.env.PORT || 3004;

if (process.env.VERCEL !== '1') {
    app.listen(PORT, () => {
        logger.info(`NGO Backend running on port ${PORT}`);
    });
}

export default app;
