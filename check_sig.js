const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const sig = await prisma.signature.findUnique({
        where: { id: 'f3828768-e294-480c-81e3-271b81638128' }
    });
    console.log(JSON.stringify(sig, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
