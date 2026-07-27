-- Task 128 hard cut: existing development backups are plaintext zip files and
-- cannot be assigned a truthful keyId. Rebuild the table without copying rows.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_InstanceBackup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "instanceLabel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "storagePath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstanceBackup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

DROP TABLE "InstanceBackup";
ALTER TABLE "new_InstanceBackup" RENAME TO "InstanceBackup";
CREATE INDEX "InstanceBackup_userId_createdAt_idx" ON "InstanceBackup"("userId", "createdAt");

PRAGMA foreign_keys=ON;
