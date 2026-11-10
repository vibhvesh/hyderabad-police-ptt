#pragma once

#include "config_store.h"

// Starts the setup access point and blocks until the form is saved, then restarts.
void provisionBlock(const HandsetConfig &seed);
bool provisionRequestedAtBoot();
