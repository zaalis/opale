package com.example.opale

import org.junit.Test
import org.junit.Assert.*
import com.example.opale.data.VaultTextLogic

class AppSearchTest {
    @Test fun frenchTextAndQuotedSearchArePreserved() {
        assertTrue(VaultTextLogic.matchesSearchQuery("\"prise de notes\"", "Idées.md", "Une prise de notes tactile."))
        assertFalse(VaultTextLogic.matchesSearchQuery("absent", "Idées.md", "Une prise de notes tactile."))
    }
}
