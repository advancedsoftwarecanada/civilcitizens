CREATE TABLE "TopicFollow" (
    "userId" TEXT NOT NULL,
    "topicSlug" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopicFollow_pkey" PRIMARY KEY ("userId","topicSlug")
);

CREATE INDEX "TopicFollow_topicSlug_idx" ON "TopicFollow"("topicSlug");

ALTER TABLE "TopicFollow"
ADD CONSTRAINT "TopicFollow_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "TopicFollow"
ADD CONSTRAINT "TopicFollow_topicSlug_fkey"
FOREIGN KEY ("topicSlug") REFERENCES "Hashtag"("tag")
ON DELETE CASCADE
ON UPDATE CASCADE;
