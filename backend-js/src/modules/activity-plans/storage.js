import { randomBytes } from 'node:crypto';
import {
  S3Client, HeadBucketCommand, CreateBucketCommand,
  PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';

export function sourceKey(organizationId, planId) {
  if (!/^[0-9a-f-]{36}$/i.test(organizationId) || !/^[0-9a-f-]{36}$/i.test(planId)) {
    throw new TypeError('A valid organization and plan ID are required');
  }
  return `organizations/${organizationId}/activity-plans/${planId}/${randomBytes(16).toString('hex')}.pdf`;
}

export function createObjectStorage({ endpoint, bucket, accessKey, secretKey }) {
  if (!endpoint || !bucket || !accessKey || !secretKey) {
    throw new Error('Object storage is not configured');
  }
  const client = new S3Client({
    endpoint, region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });
  const send = (command) => client.send(command);
  return {
    async ensureBucket({ createIfMissing = true } = {}) {
      try {
        await send(new HeadBucketCommand({ Bucket: bucket }));
      } catch (error) {
        if (!createIfMissing || ![404, 'NotFound', 'NoSuchBucket'].includes(error.$metadata?.httpStatusCode) &&
            !['NotFound', 'NoSuchBucket'].includes(error.name)) throw error;
        await send(new CreateBucketCommand({ Bucket: bucket }));
      }
    },
    async putSource(key, bytes) {
      await send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: bytes,
        ContentType: 'application/pdf', CacheControl: 'private, no-store',
      }));
    },
    async getSource(key) {
      const result = await send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await result.Body.transformToByteArray());
    },
    async deleteSource(key) {
      await send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async close() { client.destroy(); },
  };
}
