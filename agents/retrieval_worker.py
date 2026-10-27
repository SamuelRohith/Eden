"""Persistent local CPU BGE + Chroma worker. One JSON response per stdin line."""
import contextlib
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault('ANONYMIZED_TELEMETRY', 'False')
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')


class Retrieval:
    def __init__(self, options):
        import chromadb
        from chromadb.config import Settings
        import torch
        from sentence_transformers import SentenceTransformer
        torch.set_num_threads(options.get('threads', 2))
        self.path = Path(options['path'])
        self.path.mkdir(parents=True, exist_ok=True)
        self.model_name = options['model']
        self.model = SentenceTransformer(self.model_name, revision=options['revision'], device='cpu',
                                       cache_folder=options['cache'], local_files_only=not options.get('download', False),
                                       trust_remote_code=False)
        self.model.max_seq_length = 512
        if self.model.get_sentence_embedding_dimension() != 384:
            raise ValueError('Eden requires 384-dimensional BGE embeddings')
        self.client = chromadb.PersistentClient(path=str(self.path), settings=Settings(anonymized_telemetry=False))
        self.collection = self.client.get_or_create_collection(name='eden_bge_v1', embedding_function=None,
            configuration={'hnsw': {'space': 'cosine'}},
            metadata={'model': self.model_name, 'revision': options['revision'], 'dimensions': 384})
        metadata = self.collection.metadata
        if metadata.get('model') != self.model_name or metadata.get('revision') != options['revision']:
            raise ValueError('Embedding model differs from the stored collection; use a fresh Chroma path')
        self.embedded = 0
        self.retained = options.get('retain', 20)
        self.manifest_path = self.path / 'eden_matches.json'
        try:
            self.matches = json.loads(self.manifest_path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            self.matches = {}

    def encode(self, texts, query=False):
        if query:
            texts = ['Represent this sentence for searching relevant passages: ' + t for t in texts]
        return self.model.encode(texts, batch_size=16, normalize_embeddings=True, show_progress_bar=False).tolist()

    def sync(self, payload):
        match_id, docs = payload['matchId'], payload['documents']
        old = self.collection.get(where={'matchId': match_id}, include=['metadatas'])
        old_hashes = {i: m.get('hash') for i, m in zip(old['ids'], old['metadatas'])}
        ids = {d['id'] for d in docs}
        stale = [i for i in old['ids'] if i not in ids]
        if stale:
            self.collection.delete(ids=stale)
        changed = [d for d in docs if old_hashes.get(d['id']) != d['metadata']['hash']]
        for start in range(0, len(changed), 64):
            batch = changed[start:start + 64]
            self.collection.upsert(ids=[d['id'] for d in batch], documents=[d['text'] for d in batch],
                metadatas=[d['metadata'] for d in batch], embeddings=self.encode([d['text'] for d in batch]))
        self.embedded += len(changed)
        self.matches[match_id] = time.time()
        while len(self.matches) > self.retained:
            expired = min(self.matches, key=self.matches.get)
            self.collection.delete(where={'matchId': expired})
            del self.matches[expired]
        temporary = self.manifest_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.matches), encoding='utf-8')
        temporary.replace(self.manifest_path)
        return {'indexed': len(docs), 'newEmbeddings': len(changed), **self.status()}

    def query(self, payload):
        scope = payload['scope']
        filters = [{'matchId': scope['matchId']}, {'elapsed': {'$lte': scope['cutoff']}},
                   {'lastOrder': {'$lte': scope['lastOrder']}}]
        if scope.get('team') is not None and scope.get('player'):
            filters.append({f"team_{scope['team']}_player_{scope['player']}": True})
        elif scope.get('team') is not None:
            filters.append({f"team_{scope['team']}": True})
        elif scope.get('player'):
            filters.append({f"player_{scope['player']}": True})
        if self.collection.count() == 0:
            return {'hits': [], **self.status()}
        result = self.collection.query(query_embeddings=self.encode([payload['query']], query=True),
            where={'$and': filters}, n_results=payload.get('topK', 6), include=['metadatas', 'distances'])
        hits = [{'id': i, 'eventIds': json.loads(m['eventIds']), 'kind': m['kind'], 'distance': float(d)}
                for i, m, d in zip(result['ids'][0], result['metadatas'][0], result['distances'][0])]
        return {'hits': hits, **self.status()}

    def status(self):
        return {'model': self.model_name, 'dimensions': 384, 'metric': 'cosine',
                'documents': self.collection.count(), 'embeddedThisSession': self.embedded, 'device': 'cpu'}


def main():
    engine = None
    for line in sys.stdin:
        command = None
        try:
            command = json.loads(line)
            # Library banners/progress must not corrupt the JSON protocol.
            with contextlib.redirect_stdout(sys.stderr):
                action = command['action']
                if action == 'init':
                    engine = Retrieval(command['payload'])
                    result = engine.status()
                elif action == 'sync':
                    result = engine.sync(command['payload'])
                elif action == 'query':
                    result = engine.query(command['payload'])
                elif action == 'status':
                    result = engine.status()
                elif action == 'close':
                    break
                else:
                    raise ValueError('Unknown command')
            print(json.dumps({'id': command['id'], 'ok': True, 'result': result}), flush=True)
        except Exception as exc:
            if command and command.get('action') == 'init':
                print(f'Embedding setup: {type(exc).__name__}: {exc}', file=sys.stderr, flush=True)
            print(json.dumps({'id': (command or {}).get('id'), 'ok': False,
                'error': f'Local semantic retrieval failed ({type(exc).__name__}). Run npm run setup:rag and check the Chroma path.'}), flush=True)


if __name__ == '__main__':
    main()
