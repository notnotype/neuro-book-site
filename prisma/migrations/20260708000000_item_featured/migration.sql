-- 条目精选标：admin 打标，首页「编辑推荐」分区消费
ALTER TABLE "WorkshopItem" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "WorkshopItem_status_featured_idx" ON "WorkshopItem"("status", "featured");
