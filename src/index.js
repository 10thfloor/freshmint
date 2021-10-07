#!/usr/bin/env node

// This file contains the main entry point for the command line `fresh` app, and the command line option parsing code.
// See fresh.js for the core functionality.

const path = require("path");
const { Command } = require("commander");
const inquirer = require("inquirer");
const chalk = require("chalk");
const colorize = require("json-colorizer");
const ora = require("ora");
const { MakeFresh } = require("./fresh");
const generateProject = require("./generate-project");
const generateWebAssets = require("./generate-web");
const { isExists } = require("./file-helpers");
const carlton = require("./carlton");

const colorizeOptions = {
  pretty: true,
  colors: {
    STRING_KEY: "blue.bold",
    STRING_LITERAL: "green"
  }
};

const spinner = ora();

async function main() {
  const program = new Command();

  program.option(
    "-n, --network <network>",
    "Network to deploy to. Either 'testnet' or 'mainnet'"
  );

  // commands

  program
    .command("start")
    .description("initialize a new project")
    .action(start);

  program
    .command("mint")
    .description("create multiple NFTs using data from a csv file")
    .option(
      "-d, --data <csv-path>",
      "The location of the csv file to use for minting",
      "nfts.csv"
    )
    .action(batchMintNFT);

  program
    .command("mintone <image-path>")
    .description("create a new NFT from an image file")
    .option("-n, --name <name>", "The name of the NFT")
    .option("-d, --description <desc>", "A description of the NFT")
    .option(
      "-o, --owner <address>",
      "The Flow address that should own the NFT." +
        "If not provided, defaults to the first signing address."
    )
    .action(mintNFT);

  program
    .command("inspect <token-id>")
    .description("get info from Flow about an NFT using its token ID")
    .action(getNFT);

  program
    .command("start-drop")
    .description("start a new NFT drop")
    .action(startDrop);

  program
    .command("remove-drop")
    .description("remove the current NFT drop")
    .action(removeDrop);

  program
    .command("pin <token-id>")
    .description('"pin" the data for an NFT to a remote IPFS Pinning Service')
    .action(pinNFTData);

  program
    .command("up")
    .description("deploy an instance of the FreshMint NFT contract")
    .option(
      "-n, --network <name>",
      "Either: emulator, testnet, mainnet",
      "emulator"
    )
    .action(deploy);

  program
    .command("prince")
    .description("In west Philadelphia born and raised.")
    .action(() => { console.log(carlton); });

  // The hardhat and getconfig modules both expect to be running from the root directory of the project,
  // so we change the current directory to the parent dir of this script file to make things work
  // even if you call minty from elsewhere
  const rootDir = path.join(__dirname, "..");
  process.chdir(rootDir);

  await program.parseAsync(process.argv);
}

// ---- command action functions

async function start() {
  const ui = new inquirer.ui.BottomBar();
  ui.log.write(chalk.greenBright("Initializing new project. 🍃\n"));

  const questions = [
    {
      type: "input",
      name: "projectName",
      message: "Name your new project:",
      validate: async function (input) {
        if (!input) {
          return "Please enter a name for your project.";
        }

        const exists = await isExists(input);

        if (exists) {
          return "A project with that name already exists.";
        }
        return true;
      }
    },
    {
      type: "input",
      name: "contractName",
      message: "Name the NFT contract (eg. MyNFT): ",
      validate: async function (input) {
        if (!input) {
          return "Please enter a name for your contract.";
        }

        return true;
      }
    }
  ];

  const answers = await inquirer.prompt(questions);

  spinner.start("Generating project files...");

  const formattedContractName = answers.contractName
    // Remove spaces from the contract name.
    .replace(/\s*/g, "")
    .trim()
    .split(" ")
    // Ensure title-case
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");

  await generateProject(answers.projectName, formattedContractName);
  await generateWebAssets(answers.projectName, formattedContractName);

  spinner.succeed(
    `✨ Project initialized in ${chalk.white(`./${answers.projectName}\n`)}`
  );

  ui.log.write(
    `Use: ${chalk.magentaBright(
      `cd ./${answers.projectName}`
    )} to view your new project's files.\n`
  );

  ui.log.write(
    `Visit: ${chalk.blueBright(
      "https://instructions"
    )} to learn how to use your new project!`
  );
}

async function deploy({ network }) {
  const fresh = await MakeFresh();

  spinner.start(`Deploying project to ${network}`);

  await fresh.deployContracts();

  spinner.succeed(`✨ Success! Project deployed to ${network} ✨`);
}

async function batchMintNFT(options) {
  const fresh = await MakeFresh();

  const answer = await inquirer.prompt({
    type: "confirm",
    name: "confirm",
    message: `Create NFTs using data from ${path.basename(options.data)}?`
  });

  if (!answer.confirm) return;

  const result = await fresh.createNFTsFromCSVFile(options.data, (nft) => {
    console.log(colorize(JSON.stringify(nft), colorizeOptions));
  });

  console.log(`✨ Success! ${result.total} NFTs were minted! ✨`);
}

async function mintNFT(assetPath, options) {
  const fresh = await MakeFresh();

  // prompt for missing details if not provided as cli args
  const answers = await promptForMissing(options, {
    name: {
      message: "Enter a name for your new NFT: "
    },

    description: {
      message: "Enter a description for your new NFT: "
    }
  });

  const nft = await fresh.createNFTFromAssetFile(assetPath, answers);
  
  console.log("✨ Minted a new NFT: ");

  alignOutput([
    ["Token ID:", chalk.green(nft.tokenId)],
    ["Metadata Address:", chalk.blue(nft.metadataURI)],
    ["Metadata Gateway URL:", chalk.blue(nft.metadataGatewayURL)],
    ["Asset Address:", chalk.blue(nft.assetURI)],
    ["Asset Gateway URL:", chalk.blue(nft.assetGatewayURL)]
  ]);

  console.log("NFT Metadata:");
  console.log(colorize(JSON.stringify(nft.metadata), colorizeOptions));
}

async function startDrop() {
  const fresh = await MakeFresh();

  await fresh.startDrop();

  spinner.succeed(`✨ Success! Your drop is live. ✨`);
}

async function removeDrop() {
  const fresh = await MakeFresh();

  await fresh.removeDrop();

  spinner.succeed(`✨ Success! Drop removed. ✨`);
}

async function getNFT(tokenId, options) {
  const fresh = await MakeFresh();
  const nft = await fresh.getNFT(tokenId);

  const output = [
    ["Token ID:", chalk.green(nft.tokenId)],
    ["Owner Address:", chalk.yellow(nft.ownerAddress)]
  ];

  output.push(["Metadata Address:", chalk.blue(nft.metadataURI)]);
  output.push(["Metadata Gateway URL:", chalk.blue(nft.metadataGatewayURL)]);
  output.push(["Asset Address:", chalk.blue(nft.assetURI)]);
  output.push(["Asset Gateway URL:", chalk.blue(nft.assetGatewayURL)]);
  alignOutput(output);

  console.log("NFT Metadata:");
  console.log(colorize(JSON.stringify(nft.metadata), colorizeOptions));
}

async function transferNFT(tokenId, toAddress) {
  const fresh = await MakeFresh();

  await fresh.transferToken(tokenId, toAddress);
  
  console.log(
    `🌿 Transferred token ${chalk.green(tokenId)} to ${chalk.yellow(toAddress)}`
  );
}

async function pinNFTData(tokenId) {
  const fresh = await MakeFresh();
  await fresh.pinTokenData(tokenId);
  console.log(`🌿 Pinned all data for token id ${chalk.green(tokenId)}`);
}

// ---- helpers

async function promptForMissing(cliOptions, prompts) {
  const questions = [];
  for (const [name, prompt] of Object.entries(prompts)) {
    prompt.name = name;
    prompt.when = (answers) => {
      if (cliOptions[name]) {
        answers[name] = cliOptions[name];
        return false;
      }
      return true;
    };
    questions.push(prompt);
  }
  return inquirer.prompt(questions);
}

function alignOutput(labelValuePairs) {
  const maxLabelLength = labelValuePairs
    .map(([l, _]) => l.length)
    .reduce((len, max) => (len > max ? len : max));
  for (const [label, value] of labelValuePairs) {
    console.log(label.padEnd(maxLabelLength + 1), value);
  }
}

// ---- main entry point when running as a script

// make sure we catch all errors
main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
