import hashlib
import itertools
import time

class block():
    def __init__(self, index, timestamp, previousHash):
        self.index = index
        self.timestamp = timestamp
        self.previousHash = previousHash
        self.data = []
        self.hash = self.calculateHash()

    def calculateHash(self,nonce=''):
        block = [str(self.index), str(self.timestamp), self.previousHash, str(self.data), nonce]
        return hashlib.sha256('|'.join(block).encode()).hexdigest()

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
                    break 
    

class blockchain():
    def __init__(self):
        self.chain = [self.createGenesisBlock()]

    def createGenesisBlock(self):
        return block(0, timestamp=time.time_ns() // 1_000_000, previousHash="0")

    def getLatestBlock(self):
        return self.chain[-1]

    def addBlock(self, newBlock):
        newBlock.previousHash = self.getLatestBlock().hash
        newBlock.hash = newBlock.calculateHash()
        self.chain.append(newBlock)

    def isChainValid(self):
        # Placeholder for chain validation logic
        pass
    
    def deleteBlock(self, index):
        # Placeholder for block deletion logic
        pass