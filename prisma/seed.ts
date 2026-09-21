/**
 * Database seeding script
 * 
 * Seeds the initial courses (PBO and SISOP)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // Create PBO course
  const pbo = await prisma.course.upsert({
    where: { code: 'PBO' },
    update: {},
    create: {
      code: 'PBO',
      name: 'Pemrograman Berorientasi Objek',
    },
  });

  console.log('✓ Created/verified PBO course:', pbo.code);

  // Create SISOP course
  const sisop = await prisma.course.upsert({
    where: { code: 'SISOP' },
    update: {},
    create: {
      code: 'SISOP',
      name: 'Sistem Operasi',
    },
  });

  console.log('✓ Created/verified SISOP course:', sisop.code);

  console.log('\nDatabase seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
