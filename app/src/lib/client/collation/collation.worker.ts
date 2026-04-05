import { collateToAlignmentSnapshot } from './collation-adapter';
import type {
	WorkerIncomingMessage,
	WorkerOutgoingMessage,
} from './collation-worker-types';

self.onmessage = (event: MessageEvent<WorkerIncomingMessage>) => {
	void handleMessage(event.data);
};

async function handleMessage(message: WorkerIncomingMessage): Promise<void> {
	try {
		switch (message.type) {
			case 'collate':
				emit({
					type: 'result',
					requestId: message.requestId,
					result: collateToAlignmentSnapshot(message.payload),
				});
				return;
		}
	} catch (error) {
		emit({
			type: 'error',
			requestId: message.requestId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

function emit(message: WorkerOutgoingMessage): void {
	self.postMessage(message);
}
