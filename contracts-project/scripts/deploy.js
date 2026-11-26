const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying PropertyRegistry with account:", deployer.address);

  const PropertyRegistry = await hre.ethers.getContractFactory("PropertyRegistry");
  // Local development: deployer is both admin and verifier.
  const registry = await PropertyRegistry.deploy(deployer.address, deployer.address);
  await registry.waitForDeployment();

  console.log("PropertyRegistry deployed to:", await registry.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
