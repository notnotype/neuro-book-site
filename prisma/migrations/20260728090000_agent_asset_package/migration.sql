-- Rebuild Workshop tables so public versions become SemVer strings while old integer
-- versions retain their value as the internal ordinal and on-disk ZIP name.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_ItemVersion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "packageSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "changelog" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "minAppVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ItemVersion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WorkshopItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ItemVersion" ("id", "itemId", "ordinal", "version", "packageSchemaVersion", "changelog", "fileName", "fileSize", "sha256", "minAppVersion", "createdAt")
SELECT "id", "itemId", "version", CAST("version" AS TEXT) || '.0.0', 0, "changelog", "fileName", "fileSize", "sha256", "minAppVersion", "createdAt" FROM "ItemVersion";
DROP TABLE "ItemVersion";
ALTER TABLE "new_ItemVersion" RENAME TO "ItemVersion";
CREATE UNIQUE INDEX "ItemVersion_itemId_ordinal_key" ON "ItemVersion"("itemId", "ordinal");
CREATE UNIQUE INDEX "ItemVersion_itemId_version_key" ON "ItemVersion"("itemId", "version");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
