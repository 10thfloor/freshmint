const fs = require("fs/promises");
const path = require("path");
const CID = require("cids");
const { uid } = require("@onflow/util-uid");
const { NFTStorage, Blob } = require("nft.storage");
const Nebulus = require("nebulus");
const all = require("it-all");
const uint8ArrayConcat = require("uint8arrays/concat");
const uint8ArrayToString = require("uint8arrays/to-string");
const { loadDeploymentInfo } = require("./deploy");
const FlowMinter = require("../flow/flowMinter");
const generateMetadata = require("../util/generate-metadata");
// The getconfig package loads configuration from files located in the the `config` directory.
// See https://www.npmjs.com/package/getconfig for info on how to override the default config for
// different environments (e.g. testnet, mainnet, staging, production, etc).
const config = require("getconfig");

/**
 * Construct and asynchronously initialize a new Minty instance.
 * @returns {Promise<Minty>} a new instance of Minty, ready to mint NFTs.
 */
async function MakeMinty() {
  const m = new Minty();
  await m.init();
  return m;
}

async function MakeFlowMinter() {
  const m = new FlowMinter();
  await m.init();
  return m;
}

/**
 * Minty is the main object responsible for storing NFT data and interacting with the smart contract.
 * Before constructing, make sure that the contract has been deployed and a deployment
 * info file exists (the default location is `minty-deployment.json`)
 *
 * Minty requires async initialization, so the Minty class (and its constructor) are not exported.
 * To make one, use the async {@link MakeMinty} function.
 */
class Minty {
  constructor() {
    this.ipfs = null;
    this.nebulus = null;
    this.flowMinter = null;
    this.deployInfo = null;
    this._initialized = false;
  }

  async init() {
    if (this._initialized) {
      return;
    }

    // The Minty object expects that the contract has already been deployed, with
    // details written to a deployment info file. The default location is `./minty-deployment.json`,
    // in the config.
    this.deployInfo = await loadDeploymentInfo();
    this.flowMinter = await MakeFlowMinter();

    this.nebulus = new Nebulus({
      path: path.resolve(__dirname, config.nebulusPath)
    });

    this.ipfs = new NFTStorage({ token: config.pinningService.key });

    this.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    this._initialized = true;
  }

  //////////////////////////////////////////////
  // ------ NFT Creation
  //////////////////////////////////////////////
  /**
   * Create a new NFT from the given CSV data.
   *
   * @param {string} csvPath - Path to the csv data file
 
   * @typedef {object} BatchCreateNFTResult
   * @property {number} total - the total number of NFTs created

   *
   * @returns {Promise<BatchCreateNFTResult>}
   */
  async createNFTsFromCSVFile(csvPath, cb) {
    const metadatas = await this.gernerateNFTMetadata(csvPath);
    console.log("Minting started...");
    for (const metadata of metadatas) {
      const result = await this.createNFTFromAssetData({
        path: "assets/" + metadata.asset,
        ...metadata
      });
      cb(result);
      await this.sleep(config.RATE_LIMIT_MS);
    }
    return {
      total: metadatas.length
    };
  }

  /**
   * Create a new NFT from the given asset data.
   *
   * @param {object} options
   * @param {?string} path - the path to an image file or other asset to use
   * @param {?string} name - optional name to set in NFT metadata
   * @param {?string} description - optional description to store in NFT metadata
   * @param {?string} owner - optional Flow address that should own the new NFT.
   * If missing, the default signing address will be used.
   *
   * @typedef {object} CreateNFTResult
   * @property {string} txId - The id of the minting transaction
   * @property {number} tokenId - the unique ID of the new token
   * @property {string} ownerAddress - the Flow address of the new token's owner
   * @property {object} metadata - the JSON metadata stored in IPFS and referenced by the token's metadata URI
   * @property {string} metadataURI - an ipfs:// URI for the NFT metadata
   * @property {string} metadataGatewayURL - an HTTP gateway URL for the NFT metadata
   * @property {string} assetURI - an ipfs:// URI for the NFT asset
   * @property {string} assetGatewayURL - an HTTP gateway URL for the NFT asset
   *
   * @returns {Promise<CreateNFTResult>}
   */

  async createNFTFromAssetData(options) {
    const filePath = options.path || "asset.bin";
    const basename = path.basename(filePath);

    // add the asset to IPFS
    const assetCid = await this.nebulus.add(
      path.resolve(__dirname, "../" + filePath)
    );

    const assetURI = ensureIpfsUriPrefix(assetCid);
    const metadata = await this.makeNFTMetadata(assetURI, options);

    // add the metadata to IPFS
    const metadataCid = await this.nebulus.add(
      Buffer.from(JSON.stringify(metadata))
    );

    // make the NFT metadata JSON
    const metadataURI = ensureIpfsUriPrefix(metadataCid);
    // Get the address of the token owner from options, or use the default signing address if no owner is given
    let ownerAddress = options.owner;
    if (!ownerAddress) {
      ownerAddress = await this.defaultOwnerAddress();
    }

    // mint a new token referencing the metadata URI
    const minted = await this.mintToken(ownerAddress, metadataURI);
    const deposit = minted.events.find((event) =>
      event.type.includes("Deposit")
    );

    // format and return the results
    const details = {
      txId: deposit.transactionId,
      tokenId: deposit.data.id,
      ownerAddress,
      metadata,
      assetURI,
      metadataURI,
      assetGatewayURL: makeGatewayURL(assetURI),
      metadataGatewayURL: makeGatewayURL(metadataURI)
    };

    await fs.writeFile(
      path.resolve(
        __dirname,
        config.mintDataPath + `/${details.tokenId}-${uid()}.json`
      ),
      JSON.stringify(details),
      "utf8"
    );

    return details;
  }

  /**
   * Create a new NFT from an asset file at the given path.
   *
   * @param {string} filename - the path to an image file or other asset to use
   * @param {object} options
   * @param {?string} name - optional name to set in NFT metadata
   * @param {?string} description - optional description to store in NFT metadata
   * @param {?string} owner - optional Flow address that should own the new NFT.
   * If missing, the default signing address will be used.
   *
   * @returns {Promise<CreateNFTResult>}
   */
  async createNFTFromAssetFile(filename, options) {
    const content = await fs.readFile(filename);
    return this.createNFTFromAssetData(content, { ...options, path: filename });
  }

  /**
   * Helper to construct metadata JSON for
   * @param {string} assetCid - IPFS URI for the NFT asset
   * @param {object} options
   * @param {?string} name - optional name to set in NFT metadata
   * @param {?string} description - optional description to store in NFT metadata
   * @returns {object} - NFT metadata object
   */
  async makeNFTMetadata(assetURI, options) {
    assetURI = ensureIpfsUriPrefix(assetURI);
    // remove the assetpath from the options
    const { path, ...metadata } = options;
    return {
      ...metadata,
      asset: assetURI
    };
  }

  gernerateNFTMetadata(csvPath) {
    const metadata = generateMetadata(csvPath);
    return metadata;
  }

  //////////////////////////////////////////////
  // -------- NFT Retreival
  //////////////////////////////////////////////

  /**
   * Get information about an existing token.
   * By default, this includes the token id, owner address, metadata, and metadata URI.
   * To include info about when the token was created and by whom, set `opts.fetchCreationInfo` to true.
   * To include the full asset data (base64 encoded), set `opts.fetchAsset` to true.
   *
   * @param {string} tokenId
   * @param {object} opts
   * @param {?boolean} opts.fetchAsset - if true, asset data will be fetched from IPFS and returned in assetData (base64 encoded)
   * @param {?boolean} opts.fetchCreationInfo - if true, fetch historical info (creator address and block number)
   *
   *
   * @typedef {object} NFTInfo
   * @property {string} tokenId
   * @property {string} ownerAddress
   * @property {object} metadata
   * @property {string} metadataURI
   * @property {string} metadataGatewayURI
   * @property {string} assetURI
   * @property {string} assetGatewayURL
   * @property {?string} assetDataBase64
   * @property {?object} creationInfo
   * @property {string} creationInfo.creatorAddress
   * @property {number} creationInfo.blockNumber
   * @returns {Promise<NFTInfo>}
   */
  async getNFT(tokenId, opts) {
    const flowData = await this.flowMinter.getNFTDetails(
      config.adminFlowAccount,
      tokenId
    );

    const metadataURI = flowData.metadata;
    const ownerAddress = flowData.owner;
    const metadataGatewayURL = makeGatewayURL(metadataURI);

    const metadata = await this.getIPFSJSON(metadataURI);

    const nft = {
      tokenId,
      metadata,
      metadataURI,
      metadataGatewayURL,
      ownerAddress
    };

    nft.assetURI = metadata.asset;
    nft.assetGatewayURL = makeGatewayURL(metadata.asset);

    return nft;
  }

  /**
   * Fetch the NFT metadata for a given token id.
   *
   * @param tokenId - the id of an existing token
   * @returns {Promise<{metadata: object, metadataURI: string, local: boolean}>} - resolves to an object containing the metadata and
   * metadata URI. Fails if the token does not exist, or if fetching the data fails.
   */
  async getNFTMetadata(tokenId) {
    const flowData = await this.flowMinter.getNFTDetails(
      config.adminFlowAccount,
      tokenId
    );

    const metadataURI = flowData.metadata;
    const metadata = await this.getIPFSJSON(metadataURI);

    return { metadata, metadataURI };
  }

  //////////////////////////////////////////////
  // --------- Smart contract interactions
  //////////////////////////////////////////////

  /**
   * Create a new NFT token that references the given metadata CID, owned by the given address.
   *
   * @param {string} ownerAddress - the Flow address that should own the new token
   * @param {string} metadataURI - IPFS URI for the NFT metadata that should be associated with this token
   * @returns {Promise<any>} - The result from minting the token, includes events
   */
  async mintToken(ownerAddress, metadataURI) {
    // the smart contract adds an ipfs:// prefix to all URIs, so make sure it doesn't get added twice
    // metadataURI = stripIpfsUriPrefix(metadataURI);
    await this.flowMinter.setupAccount();
    const minted = await this.flowMinter.mint(ownerAddress, metadataURI);
    return minted;
  }

  async transferToken(tokenId, toAddress) {
    // TODO
  }

  /**
   * @returns {Promise<string>} - the default signing address that should own new tokens, if no owner was specified.
   */
  async defaultOwnerAddress() {
    return config.adminFlowAccount;
  }

  /**
   * Get the address that owns the given token id.
   *
   * @param {string} tokenId - the id of an existing token
   * @returns {Promise<string>} - the Flow address of the token owner. Fails if no token with the given id exists.
   */
  async getTokenOwner(tokenId) {
    return; // TODO
  }

  //////////////////////////////////////////////
  // --------- IPFS helpers
  //////////////////////////////////////////////

  /**
   * Get the contents of the IPFS object identified by the given CID or URI, and parse it as JSON, returning the parsed object.
   *
   * @param {string} cidOrURI - IPFS CID string or `ipfs://<cid>` style URI
   * @returns {Promise<string>} - contents of the IPFS object, as a javascript object (or array, etc depending on what was stored). Fails if the content isn't valid JSON.
   */
  async getIPFSJSON(cidOrURI) {
    const metadataBytes = await this.nebulus.get(stripIpfsUriPrefix(cidOrURI));
    const metadata = JSON.parse(metadataBytes.toString());
    return metadata;
  }

  //////////////////////////////////////////////
  // -------- Pinning to remote services
  //////////////////////////////////////////////

  /**
   * Pins all IPFS data associated with the given tokend id to the remote pinning service.
   *
   * @param {string} tokenId - the ID of an NFT that was previously minted.
   * @returns {ObservableLike<{assetURI: string, metadataURI: string}>} - the IPFS asset and metadata uris that were pinned.
   * Fails if no token with the given id exists, or if pinning fails.
   */

  async pinTokenData(tokenId) {
    return new Promise(async (resolve, reject) => {
      const { metadata, metadataURI } = await this.getNFTMetadata(tokenId);
      const { asset: assetURI } = metadata;

      const pin = async (cid) => {
        const data = await fs.readFile(
          path.resolve(__dirname, `../ipfs-data/ipfs/${cid}`),
          "utf8"
        );
        return await this.ipfs.storeBlob(new Blob([data]));
      };

      const meta = await pin(stripIpfsUriPrefix(metadataURI));
      console.log(`📌 ${meta} was pinned!`);
      const asset = await pin(stripIpfsUriPrefix(assetURI));
      console.log(`📌 ${asset} was pinned!`);

      resolve();
    });
  }
}

//////////////////////////////////////////////
// -------- URI helpers
//////////////////////////////////////////////

/**
 * @param {string} cidOrURI either a CID string, or a URI string of the form `ipfs://${cid}`
 * @returns the input string with the `ipfs://` prefix stripped off
 */
function stripIpfsUriPrefix(cidOrURI) {
  if (cidOrURI.startsWith("ipfs://")) {
    return cidOrURI.slice("ipfs://".length);
  }
  return cidOrURI;
}

function ensureIpfsUriPrefix(cidOrURI) {
  let uri = cidOrURI.toString();
  if (!uri.startsWith("ipfs://")) {
    uri = "ipfs://" + cidOrURI;
  }
  // Avoid the Nyan Cat bug (https://github.com/ipfs/go-ipfs/pull/7930)
  if (uri.startsWith("ipfs://ipfs/")) {
    uri = uri.replace("ipfs://ipfs/", "ipfs://");
  }
  return uri;
}

/**
 * Return an HTTP gateway URL for the given IPFS object.
 * @param {string} ipfsURI - an ipfs:// uri or CID string
 * @returns - an HTTP url to view the IPFS object on the configured gateway.
 */
function makeGatewayURL(ipfsURI) {
  return config.ipfsGatewayUrl + "/" + stripIpfsUriPrefix(ipfsURI);
}

/**
 *
 * @param {string} cidOrURI - an ipfs:// URI or CID string
 * @returns {CID} a CID for the root of the IPFS path
 */
function extractCID(cidOrURI) {
  // remove the ipfs:// prefix, split on '/' and return first path component (root CID)
  const cidString = stripIpfsUriPrefix(cidOrURI).split("/")[0];
  return new CID(cidString);
}

//////////////////////////////////////////////
// -------- Exports
//////////////////////////////////////////////

module.exports = {
  MakeMinty
};
