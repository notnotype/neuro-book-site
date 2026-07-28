PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_WorkshopItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "authorId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unlisted',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkshopItem_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_WorkshopItem" ("id", "slug", "name", "type", "title", "summary", "description", "tagsJson", "authorId", "status", "featured", "downloadCount", "likeCount", "createdAt", "updatedAt")
SELECT "id", "slug", "name", "type", "title", "summary", "description", "tagsJson", "authorId",
    CASE WHEN "status" = 'published' AND NOT EXISTS (SELECT 1 FROM "ItemVersion" WHERE "ItemVersion"."itemId" = "WorkshopItem"."id") THEN 'unlisted' ELSE "status" END,
    "featured", "downloadCount", "likeCount", "createdAt", "updatedAt"
FROM "WorkshopItem";

DROP TABLE "WorkshopItem";
ALTER TABLE "new_WorkshopItem" RENAME TO "WorkshopItem";
CREATE UNIQUE INDEX "WorkshopItem_slug_key" ON "WorkshopItem"("slug");
CREATE INDEX "WorkshopItem_status_updatedAt_idx" ON "WorkshopItem"("status", "updatedAt");
CREATE INDEX "WorkshopItem_status_featured_idx" ON "WorkshopItem"("status", "featured");
CREATE INDEX "WorkshopItem_type_status_idx" ON "WorkshopItem"("type", "status");
CREATE INDEX "WorkshopItem_authorId_idx" ON "WorkshopItem"("authorId");

ALTER TABLE "ItemVersion" ADD COLUMN "containsExecutableCode" BOOLEAN NOT NULL DEFAULT true;

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
