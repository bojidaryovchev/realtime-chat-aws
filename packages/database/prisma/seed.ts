import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Create test users
  const user1 = await prisma.user.upsert({
    where: { email: "alice@example.com" },
    update: {},
    create: {
      email: "alice@example.com",
      username: "alice",
      displayName: "Alice Johnson",
      status: "ONLINE",
    },
  });

  const user2 = await prisma.user.upsert({
    where: { email: "bob@example.com" },
    update: {},
    create: {
      email: "bob@example.com",
      username: "bob",
      displayName: "Bob Smith",
      status: "OFFLINE",
    },
  });

  const user3 = await prisma.user.upsert({
    where: { email: "charlie@example.com" },
    update: {},
    create: {
      email: "charlie@example.com",
      username: "charlie",
      displayName: "Charlie Brown",
      status: "AWAY",
    },
  });

  console.log("✅ Created users:", { user1, user2, user3 });

  // Create a direct conversation between Alice and Bob
  const directConvo = await prisma.conversation.create({
    data: {
      type: "DIRECT",
      participants: {
        create: [
          { userId: user1.id },
          { userId: user2.id },
        ],
      },
    },
  });

  console.log("✅ Created direct conversation:", directConvo.id);

  // Create a group conversation
  const groupConvo = await prisma.conversation.create({
    data: {
      type: "GROUP",
      name: "Project Team",
      participants: {
        create: [
          { userId: user1.id, role: "ADMIN" },
          { userId: user2.id },
          { userId: user3.id },
        ],
      },
    },
  });

  console.log("✅ Created group conversation:", groupConvo.id);

  // Add some messages
  const messages = await prisma.message.createMany({
    data: [
      {
        conversationId: directConvo.id,
        senderId: user1.id,
        content: "Hey Bob! How are you?",
        type: "TEXT",
      },
      {
        conversationId: directConvo.id,
        senderId: user2.id,
        content: "Hi Alice! I'm doing great, thanks!",
        type: "TEXT",
      },
      {
        conversationId: groupConvo.id,
        senderId: user1.id,
        content: "Welcome to the project team everyone!",
        type: "TEXT",
      },
    ],
  });

  console.log("✅ Created messages:", messages.count);

  console.log("🎉 Seeding completed!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
