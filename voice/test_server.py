import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

import numpy as np
from fastapi.testclient import TestClient
from voice import server


class VoiceSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = server.KEY, server.PIPELINE, server.CACHE, server.generate
        server.KEY = "test-key-that-is-never-deployed-1234"
        server.CACHE = Path(self.temp.name)
        server.PIPELINE = object()
        server.generate = Mock(return_value=np.zeros(2400, dtype=np.float32))
        self.client = TestClient(server.app)
        self.headers = {"Authorization": f"Bearer {server.KEY}"}

    def tearDown(self):
        server.KEY, server.PIPELINE, server.CACHE, server.generate = self.previous
        self.temp.cleanup()

    def test_private_health_and_generation(self):
        self.assertEqual(self.client.get("/health").status_code, 401)
        self.assertEqual(self.client.post("/v1/tts", json={"text": "Olá."}).status_code, 401)
        server.generate.assert_not_called()

    def test_repeated_text_uses_local_recording(self):
        for _ in range(2):
            result = self.client.post("/v1/tts", json={"text": "Pois não, senhor."}, headers=self.headers)
            self.assertEqual(result.status_code, 200)
            self.assertTrue(result.content.startswith(b"RIFF"))
        server.generate.assert_called_once()

    def test_rejects_empty_long_and_concurrent_speech(self):
        for text in ["   ", "a" * 1201]:
            self.assertEqual(self.client.post("/v1/tts", json={"text": text}, headers=self.headers).status_code, 422)
        server.LOCK.acquire()
        try:
            self.assertEqual(self.client.post("/v1/tts", json={"text": "Olá."}, headers=self.headers).status_code, 429)
        finally:
            server.LOCK.release()


if __name__ == "__main__":
    unittest.main()
