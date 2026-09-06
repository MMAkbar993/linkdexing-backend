// Creates the first real admin account directly in the database, so you
// don't have to log in through the legacy ADMIN_EMAIL/ADMIN_PASSWORD
// fallback first just to bootstrap one via the API.
//
// Usage:
//   node scripts/seed-admin.js "Jane Doe" jane@linkdexing.com "a-strong-password"

require("dotenv/config");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const Admin = require("../src/api/v1/admin/models/admin.entity");

async function main() {
  const [name, email, password] = process.argv.slice(2);

  if (!name || !email || !password) {
    console.error(
      'Usage: node scripts/seed-admin.js "Full Name" email@example.com password'
    );
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useCreateIndex: true,
  });

  const existing = await Admin.findOne({ email });
  if (existing) {
    console.error(`An admin with email ${email} already exists.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const admin = await Admin.create({ name, email, password: hashedPassword });

  console.log(`Admin created: ${admin.email} (${admin._id})`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Failed to create admin:", err);
  process.exit(1);
});
