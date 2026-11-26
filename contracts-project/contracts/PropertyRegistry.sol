// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title PropertyRegistry
 * @notice Append-only on-chain registry for StaySure property fingerprints and
 *         photo-verification Merkle commitments.
 * @dev Never stores PII, addresses, coordinates, or raw photos on-chain.
 */
contract PropertyRegistry is AccessControl {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    struct Property {
        address host;
        uint256 registeredAt;
        uint256 lastVerifiedAt;
        bool active;
    }

    struct Verification {
        bytes32 merkleRoot;
        bytes32 metadataHash;
        uint256 timestamp;
    }

    mapping(bytes32 => Property) private _properties;
    mapping(bytes32 => Verification[]) private _verifications;

    event PropertyRegistered(bytes32 indexed fingerprint, address indexed host);
    event PropertyVerified(
        bytes32 indexed fingerprint,
        bytes32 merkleRoot,
        uint256 indexed index,
        uint256 timestamp
    );
    event PropertyDeactivated(bytes32 indexed fingerprint);

    constructor(address admin, address verifier) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VERIFIER_ROLE, verifier);
    }
    /**
     * @notice Registers a new property fingerprint on-chain.
     * @param fingerprint HMAC-SHA256 property fingerprint computed off-chain.
     * @param host Optional host wallet address (may be address(0) if not set).
     */

    function registerProperty(bytes32 fingerprint, address host)
        external
        onlyRole(VERIFIER_ROLE)
    {
        require(
            _properties[fingerprint].registeredAt == 0,
            "Property already registered"
        );

        _properties[fingerprint] = Property({
            host: host,
            registeredAt: block.timestamp,
            lastVerifiedAt: 0,
            active: true
        });

        emit PropertyRegistered(fingerprint, host);
    }
    /**
     * @notice Appends a new verification commitment to a property's history.
     * @param fingerprint Registered property fingerprint.
     * @param merkleRoot Root of the sorted-pair Merkle tree of photo SHA-256 leaves.
     * @param metadataHash keccak256 of canonical verification metadata JSON.
     */
    function submitVerification(
        bytes32 fingerprint,
        bytes32 merkleRoot,
        bytes32 metadataHash
    ) external onlyRole(VERIFIER_ROLE) {
        Property storage prop = _properties[fingerprint];
        require(prop.registeredAt != 0, "Unknown property");
        require(prop.active, "Property inactive");

        uint256 index = _verifications[fingerprint].length;
        _verifications[fingerprint].push(
            Verification({
                merkleRoot: merkleRoot,
                metadataHash: metadataHash,
                timestamp: block.timestamp
            })
        );

        prop.lastVerifiedAt = block.timestamp;
        emit PropertyVerified(fingerprint, merkleRoot, index, block.timestamp);
    }
    /**
     * @notice Marks a registered property inactive so no new verifications can be appended.
     *         Existing verification history remains intact and readable.
     */
    function deactivateProperty(bytes32 fingerprint)
        external
        onlyRole(VERIFIER_ROLE)
    {
        Property storage prop = _properties[fingerprint];
        require(prop.registeredAt != 0, "Unknown property");

        prop.active = false;
        emit PropertyDeactivated(fingerprint);
    }
    /**
     * @notice Returns registration status, active flag, last verification timestamp, and record count.
     */
    function getStatus(bytes32 fingerprint)
        external
        view
        returns (
            bool registered,
            bool active,
            uint256 lastVerifiedAt,
            uint256 count
        )
    {
        Property storage prop = _properties[fingerprint];
        registered = prop.registeredAt != 0;
        active = prop.active;
        lastVerifiedAt = prop.lastVerifiedAt;
        count = _verifications[fingerprint].length;
    }
    /**
     * @notice Returns a specific append-only verification record by index.
     */
    function getVerification(bytes32 fingerprint, uint256 index)
        external
        view
        returns (Verification memory)
    {
        require(
            index < _verifications[fingerprint].length,
            "Invalid verification index"
        );
        return _verifications[fingerprint][index];
    }
    /**
     * @notice Verifies that a photo leaf belongs to the stored Merkle root for a given record.
     * @dev The stored root is read directly from contract storage; the caller never supplies it.
     * @param fingerprint Registered property fingerprint.
     * @param index Verification record index.
     * @param proof Sibling hashes along the Merkle path (OpenZeppelin sorted-pair order).
     * @param leaf keccak256(32-byte photo SHA-256).
     */
    function verifyPhoto(
        bytes32 fingerprint,
        uint256 index,
        bytes32[] calldata proof,
        bytes32 leaf
    ) external view returns (bool) {
        require(
            index < _verifications[fingerprint].length,
            "Invalid verification index"
        );
        bytes32 storedRoot = _verifications[fingerprint][index].merkleRoot;
        return MerkleProof.verify(proof, storedRoot, leaf);
    }
}
