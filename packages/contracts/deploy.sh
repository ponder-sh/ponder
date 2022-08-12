# Expects jq to be installed

source .env
source .env.local

if [ -z "$CHAIN_NAME" ]; then
  echo "CHAIN_NAME is not set"
  exit 1
fi

CONTRACT_NAME="ExampleNFT"

DEPLOY_OUTPUT="deploys/$CHAIN_NAME/$CONTRACT_NAME.json"
mkdir -p $(dirname $DEPLOY_OUTPUT)

if [ ! -f $DEPLOY_OUTPUT ] || [ ! -s $DEPLOY_OUTPUT ]; then
  forge create $CONTRACT_NAME --json --rpc-url=$RPC_URL --private-key=$DEPLOYER_PRIVATE_KEY | jq . > $DEPLOY_OUTPUT
fi

CONTRACT_ADDRESS=$(cat $DEPLOY_OUTPUT | jq -r ".deployedTo")
if [ -z $CONTRACT_ADDRESS ]; then
  echo "No contract address found in $DEPLOY_OUTPUT"
  exit 1
fi

echo "Using $CHAIN_NAME contract address: $CONTRACT_ADDRESS"

# cast send --rpc-url=$RPC_URL $CONTRACT_ADDRESS "setBaseTokenURI(string)" "ipfs://somehashgoeshere" --private-key=$DEPLOYER_PRIVATE_KEY
