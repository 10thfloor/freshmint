# {{ name }}

This project was generated with [freshmint](https://github.com/onflow/freshmint).

## Setup

This project requires the Flow CLI and Docker.

- [Install Flow CLI](https://docs.onflow.org/flow-cli/install/)
- [Install Docker Desktop](https://www.docker.com/products/docker-desktop)

Now install the project and its dependencies: 

```sh
npm install
```

## Quick start

This project uses the [Flow emulator](https://github.com/onflow/flow-emulator) for rapid local development.

### Start the emulator

```sh
docker-compose up -d
```

### Deploy your contract to Flow

```sh
fresh deploy
```

### Mint your NFTs

This command mints the NFTs declared in `nfts.csv`. Edit that file to add your own NFTs!

```sh
fresh mint
```

### Inspect an NFT

View the metadata for a single NFT.

```sh
fresh inspect 0
```

### Pin the NFT metadata

After you mint your NFTs, you'll need to pin the metdata to IPFS so that it's available to the world.

Hint: you can implement a blind drop by pinning the metadata _after_ your drop completes.

Fresh is compatible with [Pinata](https://www.pinata.cloud/), [NFT Storage](https://nft.storage) and any other pinning service that implements the [IPFS Remote Pinning API](https://ipfs.github.io/pinning-services-api-spec).

First configure your pinning service by editing `.env`:

**NFT Storage**

```sh
# .env
PINNING_SERVICE_ENDPOINT="https://nft.storage/api"
PINNING_SERVICE_KEY="Paste your nft.storage JWT token here!"
```

**Pinata**

```sh
# .env
PINNING_SERVICE_ENDPOINT="https://api.pinata.cloud/psa"
PINNING_SERVICE_KEY="Paste your Pinata JWT token here!"
```

Pin a single NFT:

```sh
fresh pin 0
```

### Start your drop

Start an NFT drop. This will start a new drop that lists all the NFTs currently minted.

```sh
fresh start-drop
```

Stop a drop. Once your drop is complete, you can run this command to close it.

```sh
fresh stop-drop
```

### Launch the web app

This is the last step! Run this command to launch the UI for you NFT project.

```sh
npm run dev
```