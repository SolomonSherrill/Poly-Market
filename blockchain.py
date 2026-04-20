import hashlib
import itertools
import time
import json

class block():
    def __init__(self, index, timestamp, previousHash):
        self.index = index
        self.timestamp = time.time_ns() // 1_000_000
        self.previousHash = previousHash
        self.data = []
        self.hash = self.calculateHash()
        self.nonce = ''

    def calculateHash(self):
        block = json.dumps([self.index, self.timestamp, self.previousHash, self.data, self.nonce])
        return hashlib.sha256(block).hexdigest()

    def mineBlock(self, difficulty):
        chars = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z','A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z']
        len = 0
        while True:
            len += 1
            combinations = itertools.combinations(chars, len)
            for combo in combinations:
                nonce = ''.join(combo)
                hash = self.calculateHash(nonce=nonce)
                if hash[:difficulty] == '0' * difficulty:
                    self.hash = hash
                    self.nonce = nonce
                    break 
    
    def addBet(self, prediction_id, user_id, amount, is_yes):
        bet_type = "yes" if is_yes else "no"
        data = { 
            "prediction_id": prediction_id,
            "user_id": user_id,
            "amount": amount,
            "bet_type": bet_type
        }
        self.data.append(data)
    
    toSort # Placeholder for sorting logic in javascript

    function hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            // (hash << 5) - hash is equivalent to hash * 31
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0; // Convert to 32bit integer
        }
        return hash;
    }

class blockchain():
    def __init__(self):
        self.current = block(1, previousHash="0")
        self.chain = [self.createGenesisBlock(), self.current]
        self.difficulty = 4

    def createGenesisBlock(self):
        return block(0, previousHash="0")

    def getLatestBlock(self):
        return self.chain[-1]

    def addBlock(self, newBlock):
        newBlock.previousHash = self.getLatestBlock().hash
        newBlock.hash = newBlock.calculateHash()
        self.chain.append(newBlock)

    def isChainValid(self):
        for i in range(1, len(self.chain)):
            currentBlock = self.chain[i]
            previousBlock = self.chain[i - 1]
            if currentBlock.hash != currentBlock.calculateHash():
                return False
            if currentBlock.previousHash != previousBlock.hash:
                return False
        return True
    
    def deleteBlock(self, index):
        self.chain.delete(index)
        for i in range(index, len(self.chain)):
            self.chain[i].previousHash = self.chain[i - 1].hash

    def mineCurrent(self):
        self.current.mineBlock(difficulty=4)
        self.addBlock(self.current)
        self.current = block(self.current.index + 1, previousHash=self.getLatestBlock().hash)

    