import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // Deploy ChatRoomFactory
  const deployedFactory = await deploy("ChatRoomFactory", {
    from: deployer,
    log: true,
  });

  console.log(`ChatRoomFactory deployed at: `, deployedFactory.address);
};
export default func;
func.id = "deploy_chainchat";
func.tags = ["ChatRoomFactory"];
