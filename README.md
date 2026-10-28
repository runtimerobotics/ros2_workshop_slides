# Introduction to Robot Operating System 2

A browser-based slide deck for the three-day **Hands-on Training on ROS 2 Middleware - Phase I**, scheduled for 2-4 November 2026.

The deck follows the supplied programme and covers:

- Installing ROS 2 Jazzy and setting up the environment
- What ROS 2 is, the history of ROS and ROS 2, and ROS 1 vs ROS 2
- ROS 2 architecture, DDS and its implementations, and QoS
- Topics, messages, first rclpy publisher and subscriber, ros2 bag, and rqt
- Services, actions, parameters, package anatomy, timers, and launch
- TF2, URDF, robot_state_publisher, RViz2, Gazebo Harmonic, and sensor simulation
- Manipulator fundamentals, forward and inverse kinematics, ros2_control, MoveIt 2, motion planning, Cartesian motion, and grasping

## View locally

No build step or package installation is required.

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>.

## Presentation controls

| Key | Action |
| --- | --- |
| Space / Right | Reveal the next teaching step or advance |
| Left | Hide the previous step or return to the previous slide |
| O | Slide overview |
| N | Speaker notes |
| F | Fullscreen |
| P | Print or save as PDF |
| ? | Shortcut help |

Each slide has a stable URL hash such as `#12`, so links can open a specific slide.

Complex concepts use progressive reveals so the presenter can explain one stage at a time. Motion automatically reduces when the operating system's **Reduce Motion** preference is enabled.

## Publish with GitHub Pages

The included workflow publishes the repository root whenever `main` is updated.

1. Push the repository to GitHub.
2. Open **Settings > Pages** in the GitHub repository.
3. Under **Build and deployment**, select **GitHub Actions**.
4. Open the workflow run under **Actions** and wait for deployment to finish.

The site will be available at:

<https://runtimerobotics.github.io/ros2_workshop_slides/>

## Technical baseline

Workshop commands assume:

- Ubuntu 24.04 LTS
- ROS 2 Jazzy Jalisco
- Gazebo Harmonic
- MoveIt 2 and ros2_control packages for ROS 2 Jazzy

Official references are linked from the final resource slide.
