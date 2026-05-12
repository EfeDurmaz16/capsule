# Machine Model

Machines include EC2, GCP Compute Engine, Azure VM, bare metal, Firecracker directly, Nomad, and lower-level Fly Machines.

Machines are leakier than sandboxes, jobs, services, or edge deployments. Image formats, disks, networking, firewall rules, identity, SSH, startup scripts, regions, placement, snapshots, and cleanup differ substantially.

Use the machine primitive when the user needs lower-level control. Do not hide provider-specific security, networking, volume, or lifecycle details behind false portability.

The real EC2 adapter implements the first machine primitive through `RunInstances`. It can create one instance from an AMI and instance type with optional subnet, security groups, key, IAM profile, tags, and user data. Capsule does not hide SSH, patching, IAM, network exposure, disk lifecycle, startup script security, or teardown.
