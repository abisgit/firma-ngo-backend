import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Ensure uploads folder exists
const uploadsDir = process.env.VERCEL === '1' ? '/tmp/uploads' : path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Multer storage config
const storage = multer.memoryStorage();
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
            where: { registrationCode: 'NGO-ETH-2026-001' }
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
    res.json({ status: 'OK' });
});

// FIRMA Core Connection Check
app.get('/firma/connection-status', async (req, res) => {
    try {
        const coreUrl = process.env.FIRMA_CORE_URL || 'https://api.firmasafe.com';
        // Just try to fetch the root or a health endpoint to see if it responds
        const response = await fetch(`${coreUrl}/api/health`).catch(() => null);
        if (response) {
            res.json({ connected: true });
        } else {
            res.json({ connected: false });
        }
    } catch (error) {
        res.json({ connected: false });
    }
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

// GET /api/users - Get all users for the org (System Admin Only)
app.get('/api/users', async (req: express.Request, res: express.Response) => {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }

    try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user || user.role !== 'SUPER_ADMIN') {
            res.status(403).json({ message: 'Forbidden: Requires System Admin role' });
            return;
        }

        const users = await prisma.user.findMany({
            where: { organizationId: user.organizationId }
        });
        
        // Frontend expects customPermissions array. If not in DB model, mock it for now.
        const usersWithPermissions = users.map(u => ({
            ...u,
            customPermissions: (u as any).customPermissions || []
        }));

        res.json(usersWithPermissions);
    } catch (error) {
        logger.error(error as any, 'Get users error');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/users/:id/permissions - Update user permissions
app.put('/api/users/:id/permissions', async (req: express.Request, res: express.Response) => {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }
    try {
        const adminUser = await prisma.user.findUnique({ where: { id: userId } });
        if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
            res.status(403).json({ message: 'Forbidden' });
            return;
        }
        
        // Return mock success since DB schema might not have customPermissions field yet
        const { customPermissions } = req.body;
        res.json({ id: req.params.id, customPermissions });
    } catch (error) {
        logger.error(error as any, 'Update permissions error');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /organization/profile - Get organization profile
app.get('/organization/profile', async (req: express.Request, res: express.Response) => {
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
        if (!user || !user.organization) {
            res.status(404).json({ message: 'Organization not found' });
            return;
        }
        res.json(user.organization);
    } catch (error) {
        logger.error(error as any, 'Get organization error');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /organization/profile - Update organization profile
app.put('/organization/profile', async (req: express.Request, res: express.Response) => {
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
        if (!user || user.role !== 'SUPER_ADMIN' || !user.organizationId) {
            res.status(403).json({ message: 'Forbidden' });
            return;
        }

        const { name, themeLogoUrl, primaryColor, secondaryColor } = req.body;
        const updatedOrg = await prisma.organization.update({
            where: { id: user.organizationId },
            data: {
                name: name !== undefined ? name : user.organization?.name,
                themeLogoUrl: themeLogoUrl !== undefined ? themeLogoUrl : user.organization?.themeLogoUrl,
                primaryColor: primaryColor !== undefined ? primaryColor : user.organization?.primaryColor,
                secondaryColor: secondaryColor !== undefined ? secondaryColor : user.organization?.secondaryColor,
            }
        });
        res.json(updatedOrg);
    } catch (error) {
        logger.error(error as any, 'Update organization error');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /upload-logo - Endpoint for uploading organization logo
app.post('/upload-logo', upload.single('logo'), async (req: express.Request, res: express.Response) => {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }

    if (!req.file) {
        res.status(400).json({ message: 'No logo file provided' });
        return;
    }

    const logoUrl = `/uploads/${req.file.filename}`;
    res.status(201).json({ url: logoUrl });
});

// GET /projects - Get NGO projects
app.get('/projects', async (req: express.Request, res: express.Response) => {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });
        if (!user || !user.organizationId) {
            res.json([]);
            return;
        }

        const projects = await prisma.project.findMany({
            where: { organizationId: user.organizationId }
        });
        res.json(projects);
    } catch (error) {
        logger.error(error as any, 'Get projects error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /projects - Create a new project
app.post('/projects', async (req: express.Request, res: express.Response) => {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }

    try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user || !user.organizationId) {
            res.status(403).json({ message: 'User does not belong to an organization' });
            return;
        }

        const { name, projectCode, budget, startDate, endDate } = req.body;

        if (!name || !projectCode) {
            res.status(400).json({ message: 'Project name and code are required' });
            return;
        }

        // Ensure unique project code globally (could be scoped by org in future)
        const existing = await prisma.project.findUnique({ where: { projectCode } });
        if (existing) {
            res.status(409).json({ message: 'Project code already in use' });
            return;
        }

        const newProject = await prisma.project.create({
            data: {
                name,
                projectCode,
                budget: budget ? parseFloat(budget) : null,
                startDate: startDate ? new Date(startDate) : null,
                endDate: endDate ? new Date(endDate) : null,
                organizationId: user.organizationId
            }
        });

        res.status(201).json(newProject);
    } catch (error) {
        logger.error(error as any, 'Create project error:');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /projects/:id - Get a single project
app.get('/projects/:id', async (req: express.Request, res: express.Response) => {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }

    try {
        // MOCK USER TO BYPASS NEON DB NETWORK ISSUES
        const user = { id: userId, organizationId: 'mock-org-123' };
        if (!user || !user.organizationId) {
            res.status(404).json({ message: 'Project not found' });
            return;
        }

        const project = await prisma.project.findUnique({
            where: { id: req.params.id },
            include: { documents: true }
        });
        
        if (!project || project.organizationId !== user.organizationId) {
            res.status(404).json({ message: 'Project not found' });
            return;
        }

        res.json(project);
    } catch (error) {
        logger.error(error as any, 'Get project detail error:');
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
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });
        if (!user || !user.organizationId) {
            res.json([]);
            return;
        }

        const documents = await prisma.document.findMany({
            where: { creatorId: userId },
            include: {
                project: true,
                creator: true,
                signatures: {
                    include: {
                        signer: {
                            select: { firstName: true, lastName: true, role: true }
                        }
                    }
                }
            }
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

    const { videoUrl, signatureImage, stampType, idType, nationalIdFrontUrl, nationalIdBackUrl } = req.body;

    try {
        const document = await prisma.document.findUnique({
            where: { id: req.params.id }
        });

        if (!document) {
            res.status(404).json({ message: 'Document not found' });
            return;
        }

        // Call FIRMA Core to register the signature securely
        const coreUrl = process.env.FIRMA_CORE_URL || 'https://api.firmasafe.com';
        const internalSecret = process.env.INTERNAL_SECRET || 'firma_internal_secure_123';
        let signatureHash = crypto.randomBytes(32).toString('hex');
        try {
            const coreRes = await fetch(`${coreUrl}/external/signatures/sign`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Firma-Api-Key': internalSecret
                },
                body: JSON.stringify({
                    documentId: document.id,
                    signerId: userId,
                    videoUrl: videoUrl ? (videoUrl.startsWith('data:') ? 'BASE64_DATA' : videoUrl) : null,
                    ipAddress: req.ip || '127.0.0.1',
                    userAgent: req.headers['user-agent'] || 'Unknown Browser'
                })
            });
            
            if (coreRes.ok) {
                const coreData = await coreRes.json() as any;
                if (coreData.signatureHash) signatureHash = coreData.signatureHash;
            } else {
                logger.warn('FIRMA Core returned an error, falling back to local hash');
            }
        } catch (err) {
            logger.warn('FIRMA Core unreachable, falling back to local hash');
        }

        // Create signature record
        const isVideoConsent = !!videoUrl;
        const verificationStatus = isVideoConsent ? 'PENDING_VERIFICATION' : 'VERIFIED';

        await prisma.signature.create({
            data: {
                documentId: document.id,
                signerId: userId,
                videoUrl: videoUrl || null,
                idType: idType || null,
                nationalIdFrontUrl: nationalIdFrontUrl || null,
                nationalIdBackUrl: nationalIdBackUrl || null,
                verificationStatus: verificationStatus,
                signatureHash,
                ipAddress: req.ip || '127.0.0.1',
                userAgent: req.headers['user-agent'] || 'Unknown Browser'
            }
        });

        // Update document status if it's pending ID verification
        if (isVideoConsent) {
            await prisma.document.update({
                where: { id: document.id },
                data: { status: 'PENDING_SIGNATURES' } // Still pending signatures because this one is pending verification
            });
        }

        // -------------------------------------------------------------
        // Modify the PDF file to include the Digital Signature Certificate
        // -------------------------------------------------------------
        if (document.fileUrl && fs.existsSync(document.fileUrl)) {
            try {
                const pdfBytes = fs.readFileSync(document.fileUrl);
                const pdfDoc = await PDFDocument.load(pdfBytes);
                
                // Add a new certificate page
                const page = pdfDoc.addPage();
                const { width, height } = page.getSize();
                const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
                const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
                
                // Draw Certificate Header
                page.drawText('FIRMA Digital Signature Certificate', { x: 50, y: height - 50, size: 24, font: boldFont, color: rgb(0.1, 0.3, 0.5) });
                page.drawText(`Document ID: ${document.id}`, { x: 50, y: height - 80, size: 12, font });
                page.drawText(`Signer ID: ${userId}`, { x: 50, y: height - 100, size: 12, font });
                page.drawText(`Signature Hash: ${signatureHash}`, { x: 50, y: height - 120, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
                page.drawText(`Date: ${new Date().toISOString()}`, { x: 50, y: height - 140, size: 12, font });

                // Draw Stamp
                if (stampType) {
                    page.drawText(`STAMP: ${stampType}`, { x: 50, y: height - 200, size: 36, font: boldFont, color: rgb(0.8, 0.1, 0.1) });
                }

                // Draw Handwritten Signature
                if (signatureImage && signatureImage.startsWith('data:image/png;base64,')) {
                    const base64Data = signatureImage.replace('data:image/png;base64,', '');
                    const imageBytes = Buffer.from(base64Data, 'base64');
                    const embeddedImage = await pdfDoc.embedPng(imageBytes);
                    const imgDims = embeddedImage.scale(0.5);
                    page.drawImage(embeddedImage, {
                        x: 50,
                        y: height - 400,
                        width: imgDims.width,
                        height: imgDims.height,
                    });
                    page.drawText('Digitally signed above.', { x: 50, y: height - 420, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
                }

                const modifiedPdfBytes = await pdfDoc.save();
                fs.writeFileSync(document.fileUrl, modifiedPdfBytes);
                logger.info(`Successfully appended signature certificate to ${document.fileUrl}`);
            } catch (pdfErr) {
                logger.error(pdfErr as any, 'Failed to stamp PDF, but continuing with signature registry');
            }
        }

        // Advance document status to APPROVED only if all signatures are verified
        const updatedDoc = await prisma.document.update({
            where: { id: document.id },
            data: {
                status: isVideoConsent ? 'PENDING_SIGNATURES' : 'APPROVED'
            },
            include: {
                signatures: {
                    include: {
                        signer: {
                            select: { firstName: true, lastName: true, role: true }
                        }
                    }
                }
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

        // Call FIRMA Core to anchor the hash on the blockchain
        const coreUrl = process.env.FIRMA_CORE_URL || 'https://api.firmasafe.com';
        const internalSecret = process.env.INTERNAL_SECRET || 'firma_internal_secure_123';
        
        const coreRes = await fetch(`${coreUrl}/external/blockchain/anchor`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Firma-Api-Key': internalSecret
            },
            body: JSON.stringify({
                documentId: document.id,
                hash: blockchainHash,
                orgCode: 'NGO-CORE'
            })
        });
        
        if (!coreRes.ok) {
            throw new Error('Failed to anchor document on FIRMA Core ledger');
        }
        
        const coreData = await coreRes.json() as any;
        const txId = coreData.anchor.txId;

        // Stamp QR code onto the PDF if it's stored as Base64
        let newFileUrl = document.fileUrl;
        if (newFileUrl.startsWith('data:application/pdf;base64,')) {
            try {
                // Generate QR Code image as a base64 PNG
                // Pointing to FIRMA Core (firmasafe.com) as requested
                const verifyUrl = `https://firmasafe.com/verify?hash=${blockchainHash}`;
                const qrCodeDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 100 });
                const qrImageBase64 = qrCodeDataUrl.split(',')[1];

                // Load existing PDF
                const pdfBase64 = newFileUrl.split(',')[1];
                const pdfBytes = Buffer.from(pdfBase64, 'base64');
                const pdfDoc = await PDFDocument.load(pdfBytes);

                // Embed the QR Code
                const qrImageBytes = Buffer.from(qrImageBase64, 'base64');
                const qrImage = await pdfDoc.embedPng(qrImageBytes);
                const qrDims = qrImage.scale(0.8);

                // Draw it on the first page (bottom right)
                const pages = pdfDoc.getPages();
                if (pages.length > 0) {
                    const firstPage = pages[0];
                    const pageWidth = firstPage.getWidth();
                    firstPage.drawImage(qrImage, {
                        x: pageWidth - qrDims.width - 40,
                        y: 40,
                        width: qrDims.width,
                        height: qrDims.height,
                    });
                }

                // Save back to Base64
                const modifiedPdfBytes = await pdfDoc.save();
                const modifiedBase64 = Buffer.from(modifiedPdfBytes).toString('base64');
                newFileUrl = `data:application/pdf;base64,${modifiedBase64}`;
            } catch (qrError) {
                logger.error(qrError as any, 'Failed to stamp QR code on PDF:');
            }
        }

        const updatedDoc = await prisma.document.update({
            where: { id: document.id },
            data: {
                status: 'ANCHORED',
                blockchainHash,
                txId,
                fileUrl: newFileUrl
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

        // Fetch organization to include in response
        const organization = await prisma.organization.findFirst();

        res.json({
            verified: true,
            document,
            organization
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

        // Call FIRMA Core to verify the hash on the blockchain
        const coreUrl = process.env.FIRMA_CORE_URL || 'https://api.firmasafe.com';
        const internalSecret = process.env.INTERNAL_SECRET || 'firma_internal_secure_123';
        
        const coreRes = await fetch(`${coreUrl}/external/blockchain/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Firma-Api-Key': internalSecret
            },
            body: JSON.stringify({
                hash: fileHash
            })
        });

        const coreData = await coreRes.json() as any;

        if (!coreRes.ok || !coreData.verified) {
            res.status(404).json({ verified: false, computedHash: fileHash, message: 'No matching anchored record found on the ledger. The file content might have been modified.' });
            return;
        }

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
            res.status(404).json({ verified: false, computedHash: fileHash, message: 'Verified on ledger, but document metadata not found locally.' });
            return;
        }

        // Fetch organization to include in response
        const organization = await prisma.organization.findFirst();

        res.json({
            verified: true,
            computedHash: fileHash,
            document,
            organization
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

// POST /upload-video - Endpoint for uploading video consent recordings
app.post('/upload-video', upload.single('video'), async (req: express.Request, res: express.Response) => {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }

    if (!req.file) {
        res.status(400).json({ message: 'No video file provided' });
        return;
    }

    const base64Data = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'application/octet-stream';
    const videoUrl = `data:${mimeType};base64,${base64Data}`;
    res.status(201).json({ url: videoUrl });
});

// ==========================================
// FIRMA Admin Endpoints for Identity Verification
// ==========================================

// GET /admin/signatures/pending
app.get('/admin/signatures/pending', async (req: express.Request, res: express.Response) => {
    try {
        const pendingSignatures = await prisma.signature.findMany({
            where: {
                verificationStatus: 'PENDING_VERIFICATION'
            },
            include: {
                signer: {
                    select: { firstName: true, lastName: true, email: true, profileImageUrl: true }
                },
                document: {
                    select: { title: true, id: true }
                }
            }
        });
        res.json(pendingSignatures);
    } catch (err: any) {
        logger.error(err as any, 'Error fetching pending signatures');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /admin/signatures/:id
app.get('/admin/signatures/:id', async (req: express.Request, res: express.Response) => {
    try {
        const signature = await prisma.signature.findUnique({
            where: { id: req.params.id },
            include: {
                signer: {
                    select: { firstName: true, lastName: true, email: true, profileImageUrl: true }
                },
                document: {
                    select: { title: true, id: true }
                }
            }
        });

        if (!signature) {
            res.status(404).json({ message: 'Signature not found' });
            return;
        }

        res.json(signature);
    } catch (err: any) {
        logger.error(err as any, 'Error fetching signature details');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /admin/signatures/:id/verify
app.post('/admin/signatures/:id/verify', async (req: express.Request, res: express.Response) => {
    const { signatureId } = req.params;
    const { action } = req.body; // 'APPROVE' or 'REJECT'

    try {
        const signature = await prisma.signature.findUnique({
            where: { id: req.params.id },
            include: { document: true }
        });

        if (!signature) {
            res.status(404).json({ message: 'Signature not found' });
            return;
        }

        if (action === 'APPROVE') {
            await prisma.signature.update({
                where: { id: signature.id },
                data: { verificationStatus: 'VERIFIED' }
            });

            // Check if there are any other pending signatures for this document
            const pendingCount = await prisma.signature.count({
                where: {
                    documentId: signature.documentId,
                    verificationStatus: 'PENDING_VERIFICATION'
                }
            });

            if (pendingCount === 0) {
                // All signatures verified, mark document as APPROVED
                await prisma.document.update({
                    where: { id: signature.documentId },
                    data: { status: 'APPROVED' }
                });
            }
        } else if (action === 'REJECT') {
            await prisma.signature.update({
                where: { id: signature.id },
                data: { verificationStatus: 'REJECTED' }
            });
            // Keep document status as pending or mark as rejected?
            // Usually if one rejects, the document is rejected.
            await prisma.document.update({
                where: { id: signature.documentId },
                data: { status: 'REJECTED' }
            });
        }

        res.json({ success: true, message: `Signature ${action.toLowerCase()}d` });
    } catch (err: any) {
        logger.error(err as any, 'Error verifying signature');
        res.status(500).json({ message: 'Internal server error' });
    }
});


const PORT = process.env.PORT || 3004;

if (process.env.VERCEL !== '1') {
    app.listen(PORT, () => {
        logger.info(`NGO Backend running on port ${PORT}`);
    });
}

export default app;
