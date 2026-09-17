import { createClientRequestId } from '../../shared/clientRequestId';

export function createUploadId(): string {
  return createClientRequestId();
}
