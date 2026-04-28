import hashlib
import json
import string
import time


class Block:
    def __init__(self, index: int, previous_hash: str):
        self.index = index
        self.timestamp = time.time_ns() // 1_000_000
        self.previous_hash = previous_hash
        self.data: list[dict] = []
        self.nonce = ""
        self.hash = self.calculate_hash()

    def calculate_hash(self) -> str:
        payload = json.dumps(
            [self.index, self.timestamp, self.previous_hash, self.data, self.nonce],
            sort_keys=True,
        ).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()

    def mine_block(self, difficulty: int) -> None:
        chars = string.ascii_letters + string.digits
        target = "0" * difficulty
        nonce = 0

        while True:
            self.nonce = f"{chars[nonce % len(chars)]}{nonce}"
            self.hash = self.calculate_hash()
            if self.hash.startswith(target):
                return
            nonce += 1

    def add_bet(self, prediction_id: str, user_id: str, amount: float, is_yes: bool) -> None:
        self.data.append(
            {
                "prediction_id": prediction_id,
                "user_id": user_id,
                "amount": amount,
                "bet_type": "yes" if is_yes else "no",
            }
        )


class Blockchain:
    def __init__(self):
        genesis = self.create_genesis_block()
        self.chain = [genesis]
        self.current = Block(1, genesis.hash)
        self.difficulty = 4

    def create_genesis_block(self) -> Block:
        return Block(0, "0")

    def get_latest_block(self) -> Block:
        return self.chain[-1]

    def add_block(self, new_block: Block) -> None:
        new_block.previous_hash = self.get_latest_block().hash
        new_block.hash = new_block.calculate_hash()
        self.chain.append(new_block)

    def is_chain_valid(self) -> bool:
        for index in range(1, len(self.chain)):
            current_block = self.chain[index]
            previous_block = self.chain[index - 1]
            if current_block.hash != current_block.calculate_hash():
                return False
            if current_block.previous_hash != previous_block.hash:
                return False
        return True

    def delete_block(self, index: int) -> None:
        del self.chain[index]
        for position in range(max(index, 1), len(self.chain)):
            self.chain[position].previous_hash = self.chain[position - 1].hash
            self.chain[position].hash = self.chain[position].calculate_hash()

    def mine_current(self) -> None:
        self.current.mine_block(self.difficulty)
        self.add_block(self.current)
        self.current = Block(self.current.index + 1, self.get_latest_block().hash)
lf.current = block(self.current.index + 1, previousHash=self.getLatestBlock().hash)

    