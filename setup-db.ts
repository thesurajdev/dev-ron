#!/usr/bin/env node

/**
 * Database Verification & Setup Guide
 * Checks Supabase connection and provides setup instructions
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("\n❌ Missing environment variables:\n");
  console.error("   SUPABASE_URL:", supabaseUrl ? "✓" : "✗ NOT SET");
  console.error("   SUPABASE_ANON_KEY:", supabaseKey ? "✓" : "✗ NOT SET\n");
  console.error(
    "Please update .env file with your Supabase credentials.\n"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupDatabase() {
  try {
    console.log("\n╔════════════════════════════════════════════════════════════════╗");
    console.log("║           DATABASE SETUP & VERIFICATION GUIDE                  ║");
    console.log("╚════════════════════════════════════════════════════════════════╝\n");

    console.log("1️⃣  CHECKING SUPABASE CONNECTION...\n");

    // Test connection
    const { data, error } = await supabase.auth.getSession();

    if (!error && supabaseUrl && supabaseKey) {
      console.log("   ✅ Supabase connection successful");
      console.log(
        `   ✅ Connected to: ${supabaseUrl.replace(
          /https:\/\//,
          ""
        )}\n`
      );
    } else {
      throw new Error("Connection test failed");
    }

    console.log("2️⃣  CHECKING EXISTING TABLES...\n");

    // Check if tables exist
    let tablesExist = true;
    const tables = ["entities", "activities", "metrics"];

    for (const table of tables) {
      try {
        const { error: checkError } = await supabase
          .from(table)
          .select("id")
          .limit(1);

        if (!checkError) {
          console.log(`   ✅ Table '${table}' exists`);
        } else if (
          checkError.message.includes("relation") ||
          checkError.message.includes("does not exist")
        ) {
          console.log(`   ❌ Table '${table}' NOT FOUND`);
          tablesExist = false;
        }
      } catch (e) {
        console.log(`   ⚠️  Could not check '${table}'`);
        tablesExist = false;
      }
    }

    if (tablesExist) {
      console.log("\n✅ ALL TABLES EXIST - DATABASE IS READY!\n");
      console.log("🎉 You can now:\n");
      console.log("   • npm run dev:server");
      console.log("   • Start testing MCP endpoints");
      console.log("   • Deploy to production\n");
      return true;
    } else {
      console.log("\n⏳ TABLES NEED TO BE CREATED\n");
      console.log("3️⃣  EXECUTE SETUP SQL\n");
      console.log("   Follow these steps:\n");
      console.log("   a) Go to: Supabase Console → SQL Editor");
      console.log("   b) Click 'New Query'");
      console.log("   c) Copy SQL from: SETUP_DATABASE.md (lines 6-109)");
      console.log(
        "   d) Paste the complete SQL and click Execute\n"
      );
      console.log("   The SQL creates:");
      console.log("   • entities table (JSONB flexible storage)");
      console.log("   • activities table (interaction tracking)");
      console.log("   • metrics table (KPI tracking)");
      console.log("   • All necessary indexes for performance\n");
      console.log("⏭️  AFTER EXECUTING SQL:\n");
      console.log("   1. Run: npm run build");
      console.log("   2. Run: npm run dev:server");
      console.log("   3. Test with QUICK_START.md examples\n");
      return false;
    }
  } catch (err: any) {
    console.error("\n❌ Error:", err.message || err);
    console.log(
      "\n💡 Troubleshooting:\n"
    );
    console.log(
      "   • Check .env file exists with correct Supabase credentials"
    );
    console.log(
      "   • Verify SUPABASE_URL and SUPABASE_ANON_KEY are set"
    );
    console.log("   • Go to Supabase Dashboard → Settings → API\n");
    return false;
  }
}

setupDatabase().then((success) => {
  process.exit(success ? 0 : 1);
});
